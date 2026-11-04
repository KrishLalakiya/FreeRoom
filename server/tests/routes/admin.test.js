import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';

/**
 * Runs the real admin router over HTTP. Only the database is faked, and the fake rejects any
 * query whose $n placeholders do not match its parameters, as Postgres would.
 */
const db = vi.hoisted(() => ({ respond: () => ({ rows: [] }), log: [] }));

vi.mock('../../src/config/db.js', () => {
  const run = async (sql, params = []) => {
    const placeholders = [...sql.matchAll(/\$(\d+)/g)].map((match) => Number(match[1]));
    const highest = placeholders.length > 0 ? Math.max(...placeholders) : 0;
    if (highest !== params.length) {
      throw new Error(`bind message supplies ${params.length} parameters, but statement requires ${highest}: ${sql}`);
    }
    db.log.push({ sql, params });
    if (/SELECT role FROM users/.test(sql)) return { rows: [{ role: 'admin' }] };
    return db.respond(sql, params) || { rows: [] };
  };
  const query = vi.fn(run);
  const getClient = vi.fn(async () => ({ query: run, release: () => {} }));
  return { query, getClient, default: { query, connect: getClient } };
});

const { default: adminRouter } = await import('../../src/routes/admin.js');
const { generateToken } = await import('../../src/middleware/auth.js');
const { availabilityCache } = await import('../../src/services/cache.js');

let server;
let baseUrl;
const token = generateToken({ id: 1, email: 'admin@test', name: 'Admin', role: 'admin' });

async function api(method, path, body) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
}

const sqlRan = (pattern) => db.log.filter((entry) => pattern.test(entry.sql));

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/admin', adminRouter);
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}/api/admin`;
});

afterAll(() => new Promise((resolve) => server.close(resolve)));

beforeEach(() => {
  db.log.length = 0;
  db.respond = () => ({ rows: [] });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('page-load endpoints', () => {
  // Any one of these failing used to blank the whole admin panel.
  it.each([
    '/events', '/timetable', '/cancellations', '/room-aliases', '/terms', '/closures', '/no-class-days', '/action-logs', '/settings',
  ])('GET %s succeeds', async (path) => {
    const res = await api('GET', path);
    expect(res.status).toBe(200);
  });

  it.each([
    '/timetable?roomId=3', '/timetable?termId=2', '/timetable?roomId=3&termId=2', '/timetable?limit=5&offset=10',
  ])('GET %s binds its LIMIT and OFFSET', async (path) => {
    const res = await api('GET', path);
    expect(res.status).toBe(200);
  });

  it('passes paging through to the query', async () => {
    await api('GET', '/timetable?limit=5&offset=10');
    const [{ sql, params }] = sqlRan(/FROM timetable_entries/);
    expect(sql).toMatch(/LIMIT \$1 OFFSET \$2/);
    expect(params).toEqual([5, 10]);
  });
});

describe('invalid ids', () => {
  it.each([
    ['DELETE', '/events/abc'],
    ['DELETE', '/cancellations/abc'],
    ['DELETE', '/cancellations/0'],
    ['DELETE', '/cancellations/1.5'],
    ['DELETE', '/cancellations/99999999999'],
    ['DELETE', '/terms/abc'],
    ['DELETE', '/room-aliases/abc'],
    ['DELETE', '/closures/abc'],
    ['DELETE', '/no-class-days/abc'],
    ['DELETE', '/events/99999999999'],
    ['PUT', '/terms/abc'],
  ])('%s %s is a 400, not a database error', async (method, path) => {
    const res = await api(method, path, method === 'PUT' ? {} : undefined);
    expect(res.status).toBe(400);
  });
});

describe('POST /events', () => {
  const valid = { roomId: 3, title: 'Seminar', startAt: '2027-02-01T09:00:00Z', endAt: '2027-02-01T10:00:00Z' };

  it('rejects unparseable dates', async () => {
    const res = await api('POST', '/events', { ...valid, startAt: 'nonsense' });
    expect(res.status).toBe(400);
  });

  it('returns 404 for an unknown room', async () => {
    const res = await api('POST', '/events', { ...valid, roomId: 999 });
    expect(res.status).toBe(404);
  });

  it('checks clashes in rooms sharing the same space', async () => {
    db.respond = (sql) => {
      if (/FROM rooms/.test(sql)) return { rows: [{ id: 3 }, { id: 4 }, { id: 5 }] };
      if (/FROM events/.test(sql)) return { rows: [{ id: 9, title: 'Exam in 2B1' }] };
      return null;
    };
    const res = await api('POST', '/events', valid);
    expect(res.status).toBe(409);
    expect(sqlRan(/FROM events/)[0].params[0]).toEqual([3, 4, 5]);
  });
});

describe('POST /cancel-class', () => {
  // 2026-11-16 is a Monday.
  const entry = { day_of_week: 1, valid_from: '2026-10-29', valid_to: '2027-01-31', term_start: '2026-10-29', term_end: '2027-01-31' };

  beforeEach(() => {
    db.respond = (sql) => {
      if (/FROM timetable_entries/.test(sql)) return { rows: [entry] };
      if (/INSERT INTO schedule_exceptions/.test(sql)) return { rows: [{ id: 1 }] };
      return null;
    };
  });

  it('cancels a class on a day it runs', async () => {
    const res = await api('POST', '/cancel-class', { timetableEntryId: 1, date: '2026-11-16' });
    expect(res.status).toBe(201);
  });

  it('rejects a date on another weekday instead of claiming the room was freed', async () => {
    const res = await api('POST', '/cancel-class', { timetableEntryId: 1, date: '2026-11-17' });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('Monday');
    expect(sqlRan(/INSERT INTO schedule_exceptions/)).toHaveLength(0);
  });

  it('rejects a date outside the term', async () => {
    const res = await api('POST', '/cancel-class', { timetableEntryId: 1, date: '2027-02-01' });
    expect(res.status).toBe(400);
  });

  it('rejects an impossible date', async () => {
    const res = await api('POST', '/cancel-class', { timetableEntryId: 1, date: '2026-13-45' });
    expect(res.status).toBe(400);
  });
});

describe('GET /cancellations', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it('returns cancellations with their class, room and batch', async () => {
    const row = {
      id: 4, timetable_entry_id: 9, date: '2026-11-16', reason: 'Instructor on leave',
      course_name: 'Maths', start_time: '09:00:00', end_time: '10:00:00', room_name: '2A', batch_year: 2027,
    };
    db.respond = (sql) => (/FROM schedule_exceptions/.test(sql) ? { rows: [row] } : null);

    const res = await api('GET', '/cancellations');

    expect(res.status).toBe(200);
    expect(res.body.cancellations).toEqual([row]);
    const [{ sql }] = sqlRan(/FROM schedule_exceptions/);
    expect(sql).toMatch(/JOIN timetable_entries/);
    expect(sql).toMatch(/JOIN rooms/);
    // Legacy entries have no term, and must still be listed so they can be restored.
    expect(sql).toMatch(/LEFT JOIN terms/);
    expect(sql).toMatch(/LEFT JOIN batches/);
  });

  it('counts upcoming from the campus date, not the UTC date', async () => {
    vi.stubEnv('CAMPUS_TIMEZONE', 'Asia/Kolkata');
    vi.useFakeTimers({ toFake: ['Date'] });
    // 20:00 UTC on the 4th is already 01:30 on the 5th in Kolkata.
    vi.setSystemTime(new Date('2026-11-04T20:00:00Z'));

    await api('GET', '/cancellations');

    const [{ sql, params }] = sqlRan(/FROM schedule_exceptions/);
    expect(sql).toMatch(/se\.date >= \$1/);
    expect(params).toEqual(['2026-11-05']);
  });

  it('reports a database failure as a 500', async () => {
    db.respond = () => {
      throw new Error('connection lost');
    };
    const res = await api('GET', '/cancellations');
    expect(res.status).toBe(500);
  });
});

describe('DELETE /cancellations/:id', () => {
  const row = { id: 4, timetable_entry_id: 9, date: '2026-11-16', reason: 'Instructor on leave' };

  it('restores the class, drops cached availability and logs the action', async () => {
    availabilityCache.set('free_now:stale', { rooms: [] });
    db.respond = (sql) => (/DELETE FROM schedule_exceptions/.test(sql) ? { rows: [row] } : null);

    const res = await api('DELETE', '/cancellations/4');

    expect(res.status).toBe(200);
    expect(res.body.cancellation).toEqual(row);
    expect(sqlRan(/DELETE FROM schedule_exceptions/)[0].params).toEqual([4]);
    expect(availabilityCache.get('free_now:stale')).toBeNull();
    const [log] = sqlRan(/INSERT INTO admin_actions/);
    expect(log.params[2]).toBe('restore_class');
    expect(log.params[3]).toContain('2026-11-16');
    expect(JSON.parse(log.params[4])).toEqual({ cancellationId: 4, timetableEntryId: 9, date: '2026-11-16' });
  });

  it('returns 404 for an unknown id, leaving the cache and log alone', async () => {
    availabilityCache.set('free_now:kept', { rooms: [] });

    const res = await api('DELETE', '/cancellations/4');

    expect(res.status).toBe(404);
    expect(availabilityCache.get('free_now:kept')).not.toBeNull();
    expect(sqlRan(/INSERT INTO admin_actions/)).toHaveLength(0);
    availabilityCache.clear();
  });

  it('does not touch the database for an invalid id', async () => {
    const res = await api('DELETE', '/cancellations/abc');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid id');
    expect(sqlRan(/schedule_exceptions/)).toHaveLength(0);
  });
});

describe('POST /terms', () => {
  it('rejects a non-numeric batch year', async () => {
    const res = await api('POST', '/terms', {
      batchYear: 'abc', semesterNumber: 1, termNumber: 1, startDate: '2027-01-01', endDate: '2027-02-01',
    });
    expect(res.status).toBe(400);
  });
});

describe('PUT /terms/:id', () => {
  it('keeps timetable entry dates in step with the term', async () => {
    db.respond = (sql) => {
      if (/SELECT \* FROM terms/.test(sql)) {
        return { rows: [{ id: 7, batch_id: 1, semester_number: 1, term_number: 1, start_date: '2027-01-01', end_date: '2027-02-01' }] };
      }
      if (/UPDATE terms/.test(sql)) return { rows: [{ id: 7 }] };
      return null;
    };
    const res = await api('PUT', '/terms/7', { endDate: '2027-03-01' });
    expect(res.status).toBe(200);
    expect(sqlRan(/UPDATE timetable_entries/)[0].params).toEqual(['2027-01-01', '2027-03-01', 7]);
  });
});

describe('POST /closures', () => {
  const body = { scope: 'building', startDate: '2027-02-10', endDate: '2027-02-20', reason: 'Exam' };

  it('rejects an unreadable time', async () => {
    const res = await api('POST', '/closures', { ...body, startTime: 'banana', endTime: 'zzz' });
    expect(res.status).toBe(400);
  });

  it('folds every overlapping closure into one and logs the merge', async () => {
    db.respond = (sql) => {
      if (/SELECT \* FROM closures/.test(sql)) {
        return {
          rows: [
            { id: 1, start_date: '2027-02-08', end_date: '2027-02-12', start_time: null, end_time: null, note: 'first', reason: 'Exam' },
            { id: 2, start_date: '2027-02-18', end_date: '2027-02-25', start_time: null, end_time: null, note: 'second', reason: 'Exam' },
          ],
        };
      }
      if (/UPDATE closures/.test(sql)) return { rows: [{ id: 1 }] };
      return null;
    };

    const res = await api('POST', '/closures', body);

    expect(res.status).toBe(200);
    expect(res.body.merged).toBe(true);
    const [update] = sqlRan(/UPDATE closures/);
    expect(update.params.slice(0, 2)).toEqual(['2027-02-08', '2027-02-25']);
    expect(update.params[5]).toBe('first; second');
    expect(sqlRan(/DELETE FROM closures/)[0].params[0]).toEqual([2]);
    expect(sqlRan(/INSERT INTO admin_actions/)[0].params[2]).toBe('merge_closure');
  });

  it('only merges floor closures within the same building', async () => {
    await api('POST', '/closures', { ...body, scope: 'floor', floor: '1st' });
    // Reached only if the floor exists, so make it exist and repeat.
    db.log.length = 0;
    db.respond = (sql) => (/SELECT 1 FROM rooms/.test(sql) ? { rows: [{}] } : (/INSERT INTO closures/.test(sql) ? { rows: [{ id: 1 }] } : null));
    await api('POST', '/closures', { ...body, scope: 'floor', floor: '1st' });
    expect(sqlRan(/SELECT \* FROM closures/)[0].sql).toMatch(/'floor' AND building_id = \$2/);
  });
});

describe('PUT /settings', () => {
  it.each([
    [{ chain_min_free_minutes: -5 }],
    [{ chain_min_free_minutes: 'abc' }],
    [{ buffer_minutes: 61 }],
    [{ chain_enabled: 'yes' }],
  ])('rejects %j instead of reporting success', async (body) => {
    const res = await api('PUT', '/settings', body);
    expect(res.status).toBe(400);
    expect(sqlRan(/INSERT INTO system_settings/)).toHaveLength(0);
  });

  it('saves valid settings and drops results cached under the old ones', async () => {
    availabilityCache.set('free_now:stale', { rooms: [] });
    const res = await api('PUT', '/settings', { chain_min_free_minutes: 20, chain_enabled: false, buffer_minutes: 5 });
    expect(res.status).toBe(200);
    expect(sqlRan(/INSERT INTO system_settings/)).toHaveLength(3);
    expect(availabilityCache.get('free_now:stale')).toBeNull();
  });
});
