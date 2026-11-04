/**
 * My Group view (C20), run against the real rooms router and availability engine.
 * Only the database is faked.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/config/db.js', async () => (await import('../helpers/fakeDb.js')).fakeDbModule);

import { db, resetDb, selectWhere } from '../helpers/fakeDb.js';
import { startRouter } from '../helpers/fixtures.js';
import roomsRouter from '../../src/routes/rooms.js';
import { generateToken } from '../../src/middleware/auth.js';
import { clearAvailabilityCache, getFreeRoomsForWindow } from '../../src/services/availabilityEngine.js';

describe('My Group Schedule and Gaps (C20, PRD Section 2)', () => {
  const DATE = '2026-11-16'; // a Monday
  const terms = [{ id: 1, year: 2029, term_number: 5, semester_number: 3, start_date: '2026-08-01', end_date: '2099-12-31' }];
  const rooms = [
    { id: 1, name: '1A', floor: '1st', capacity: 40, is_study_allowed: true },
    { id: 2, name: '2A', floor: '2nd', capacity: 40, is_study_allowed: true },
    { id: 57, name: 'SSB', floor: 'Ground', capacity: 40, is_study_allowed: false },
  ];
  // An admin token is what lets a test set the clock with ?now=.
  const token = generateToken({ id: 1, role: 'admin' });
  let app;

  const entry = ({ id, subject = 'Class', start, end, groups = [] }) => ({
    id,
    room_id: 1,
    room_name: '1A',
    floor: '1st',
    capacity: 40,
    start_time: `${start}:00`,
    end_time: `${end}:00`,
    entry_type: 'class',
    subject_name: subject,
    subject_code: null,
    instructor_name: null,
    groups_list: groups.length > 0 ? groups : null,
  });

  const respond = (entries, { filterRooms = true } = {}) => (sql, params) => {
    if (/ARRAY_AGG/.test(sql)) return { rows: entries };
    if (/FROM terms WHERE|FROM terms t\s+JOIN batches b ON b.id = t.batch_id\s+WHERE b.year/.test(sql)) {
      return { rows: selectWhere(sql, params, terms) };
    }
    if (/FROM system_settings/.test(sql)) return { rows: [{ key: 'chain_min_free_minutes', value: 15 }] };
    if (/FROM buildings/.test(sql)) return { rows: [{ id: 1, opening_time: '06:00', closing_time: '22:00' }] };
    if (/WHERE r\.building_id = \$1\s+AND r\.is_study_allowed/.test(sql)) {
      return { rows: filterRooms ? selectWhere(sql, params, rooms.map((r) => ({ ...r, building_id: 1 }))) : rooms };
    }
    return null;
  };

  const get = async (path) => {
    const res = await fetch(`${app.url}${path}`, { headers: { Authorization: `Bearer ${token}` } });
    expect(res.status).toBe(200);
    return res.json();
  };

  const myGroup = (entries, { group = 'Group A', time = '09:00' } = {}) => {
    db.respond = respond(entries);
    const params = new URLSearchParams({ batchYear: '2029', group, date: DATE, now: `${DATE}T${time}:00` });
    return get(`/my-group?${params}`);
  };

  beforeAll(async () => {
    app = await startRouter(roomsRouter);
  });
  afterAll(() => app.close());

  beforeEach(() => {
    resetDb();
    clearAvailabilityCache();
  });

  const sampleClasses = [
    entry({ id: 1, subject: 'MERN', start: '09:00', end: '10:45', groups: ['Group A'] }),
    entry({ id: 2, subject: 'CN', start: '09:00', end: '10:45', groups: ['Group B'] }),
    entry({ id: 3, subject: 'Adv Graph Algo', start: '11:15', end: '13:00' }), // Whole batch
    entry({ id: 4, subject: 'C++ Systems', start: '14:00', end: '15:30', groups: ['Group A', 'Group B'] }), // Combined
    entry({ id: 5, subject: 'MERN Lab', start: '15:35', end: '17:00', groups: ['Group A'] }), // 5 min gap (should be ignored)
  ];

  const summarise = ({ start, end, duration_minutes, is_after_last_class }) => ({
    start, end, duration_minutes, is_after_last_class,
  });

  it('filters classes correctly for Group A', async () => {
    const { classes } = await myGroup(sampleClasses);
    expect(classes.map((c) => c.subject)).toEqual([
      'MERN',
      'Adv Graph Algo',
      'C++ Systems',
      'MERN Lab',
    ]);
  });

  it('filters classes correctly for Group B', async () => {
    const { classes } = await myGroup(sampleClasses, { group: 'Group B' });
    expect(classes.map((c) => c.subject)).toEqual([
      'CN',
      'Adv Graph Algo',
      'C++ Systems',
    ]);
  });

  it('calculates breaks and gaps between classes for Group A', async () => {
    const { gaps } = await myGroup(sampleClasses);

    // Gaps expected:
    // 10:45 to 11:15 (30 mins)
    // 13:00 to 14:00 (60 mins)
    // 15:30 to 15:35 is 5 mins (below 15 min threshold -> ignored)
    // 17:00 to closing is the free time after the last class (PRD v8)
    expect(gaps.map(summarise)).toEqual([
      { start: '10:45', end: '11:15', duration_minutes: 30, is_after_last_class: false },
      { start: '13:00', end: '14:00', duration_minutes: 60, is_after_last_class: false },
      { start: '17:00', end: '22:00', duration_minutes: 300, is_after_last_class: true },
    ]);
  });

  it('returns no gaps when classes are contiguous or below threshold', async () => {
    const contiguous = [
      entry({ id: 10, start: '09:00', end: '10:00' }),
      entry({ id: 11, start: '10:00', end: '11:00' }),
      entry({ id: 12, start: '11:05', end: '12:00' }), // 5 mins
    ];
    const { gaps } = await myGroup(contiguous);

    // Only the free time after the last class remains; nothing between the classes.
    expect(gaps.filter((gap) => !gap.is_after_last_class)).toEqual([]);
    expect(gaps.map(summarise)).toEqual([
      { start: '12:00', end: '22:00', duration_minutes: 600, is_after_last_class: true },
    ]);
  });

  describe('excludes SSB from free study rooms for all batches via room flag (PRD Item 8 & Test 7)', () => {
    const names = (list) => list.map((r) => r.name);

    it('in the My Group gap rooms, even if the query returned it', async () => {
      db.respond = respond(sampleClasses, { filterRooms: false });
      const { gaps } = await get(`/my-group?batchYear=2029&group=A&date=${DATE}&now=${DATE}T09:00:00`);
      expect(names(gaps[0].free_rooms)).toEqual(['1A', '2A']);
    });

    it('in the free-window route, even if the query returned it', async () => {
      db.respond = respond([], { filterRooms: false });
      const { rooms: found } = await get('/free-window?date=2099-01-05&startTime=10:00&endTime=11:00');
      expect(names(found)).toEqual(['1A', '2A']);
    });

    it('in the engine query itself', async () => {
      db.respond = respond([]);
      const { rooms: found } = await getFreeRoomsForWindow({ buildingId: 1, date: DATE, startTime: '10:00', endTime: '11:00' });
      expect(names(found)).toEqual(['1A', '2A']);
    });
  });

  it('does not match compound group AB when querying for group A (discrete matching)', async () => {
    const classes = [
      entry({ id: 1, subject: 'Subject 1', start: '09:00', end: '10:00', groups: ['AB'] }),
      entry({ id: 2, subject: 'Subject 2', start: '10:00', end: '11:00', groups: ['A'] }),
      entry({ id: 3, subject: 'Subject 3', start: '11:00', end: '12:00', groups: ['A + B'] }),
    ];
    const { classes: filtered } = await myGroup(classes, { group: 'A' });
    expect(filtered.map((c) => c.id)).toEqual([2, 3]);
  });

  it('correctly detects whether current time is before or after last class', async () => {
    const todayClasses = [
      entry({ id: 1, subject: 'MERN', start: '09:00', end: '11:00' }),
      entry({ id: 2, subject: 'DSA', start: '14:00', end: '15:30' }),
    ];
    const isAfterLastClass = async (time) => {
      const body = await myGroup(todayClasses, { time });
      return body.is_after_last_class;
    };

    // Morning (e.g. 10:19 AM): before last class -> false (keep today)
    expect(await isAfterLastClass('10:19')).toBe(false);
    expect(await isAfterLastClass('15:29')).toBe(false);

    // After last class ended -> true (switch to tomorrow)
    expect(await isAfterLastClass('15:30')).toBe(true);
    expect(await isAfterLastClass('18:00')).toBe(true);
  });

  it('handles empty class days by keeping today during campus hours and advancing after 17:00', async () => {
    const isAfterLastClass = async (time) => {
      const body = await myGroup([], { time });
      return body.is_after_last_class;
    };

    expect(await isAfterLastClass('10:19')).toBe(false);
    expect(await isAfterLastClass('14:00')).toBe(false);
    expect(await isAfterLastClass('17:01')).toBe(true);
    expect(await isAfterLastClass('20:00')).toBe(true);
  });
});
