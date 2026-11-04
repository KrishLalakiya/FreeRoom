/**
 * Validation and failure handling (C11), run against the real admin routes and importer.
 * Only the database is faked.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/config/db.js', async () => (await import('../helpers/fakeDb.js')).fakeDbModule);

import { db, resetDb, selectWhere, sqlRan } from '../helpers/fakeDb.js';
import { buildTimetable, respondForImport, startRouter } from '../helpers/fixtures.js';
import adminRouter from '../../src/routes/admin.js';
import { generateToken } from '../../src/middleware/auth.js';
import { importTimetable } from '../../src/services/timetableImport.js';

describe('Validation and Failure Handling (C11, PRD Sections 3 & 4)', () => {
  let app;

  const send = async (method, path, body) => {
    const res = await fetch(`${app.url}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${generateToken({ id: 1, role: 'admin' })}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  };

  beforeAll(async () => {
    app = await startRouter(adminRouter);
  });
  afterAll(() => app.close());

  beforeEach(() => {
    resetDb();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  describe('Closure validation rules', () => {
    const createClosure = (body) => send('POST', '/closures', body);

    it('rejects a closure ending before it starts (end_date < start_date)', async () => {
      const res = await createClosure({
        scope: 'building',
        startDate: '2026-11-10',
        endDate: '2026-11-05',
      });
      expect(res.status).toBe(400);
      expect(res.body.message).toContain('End date must be on or after start date');
    });

    it('rejects a closure where end_time <= start_time', async () => {
      const res = await createClosure({
        scope: 'building',
        startDate: '2026-11-10',
        endDate: '2026-11-10',
        startTime: '14:00',
        endTime: '12:00',
      });
      expect(res.status).toBe(400);
      expect(res.body.message).toContain('End time must be after start time');
    });

    it('rejects a closure where end_time === start_time', async () => {
      const res = await createClosure({
        scope: 'building',
        startDate: '2026-11-10',
        endDate: '2026-11-10',
        startTime: '14:00',
        endTime: '14:00',
      });
      expect(res.status).toBe(400);
      expect(res.body.message).toContain('End time must be after start time');
    });

    it('rejects a closure naming a room that does not exist with 404', async () => {
      const res = await createClosure({
        scope: 'room',
        roomId: 999,
        startDate: '2026-11-10',
      });
      expect(res.status).toBe(404);
      expect(res.body.message).toContain('Room with id 999 does not exist');
    });

    it('rejects a closure naming a floor that does not exist with 404', async () => {
      const res = await createClosure({
        scope: 'floor',
        floor: '4th',
        startDate: '2026-11-10',
      });
      expect(res.status).toBe(404);
      expect(res.body.message).toContain('Floor "4th" does not exist');
    });

    it('allows past closure dates but flags them with a warning', async () => {
      db.respond = (sql) => (/INSERT INTO closures/.test(sql) ? { rows: [{ id: 1 }] } : null);

      const past = await createClosure({
        scope: 'building',
        startDate: '2026-09-01',
        endDate: '2026-09-02',
      });
      expect(past.status).toBe(201);
      expect(past.body.warning).toContain('Closure is scheduled in the past. Recorded for historical accuracy.');

      const future = await createClosure({ scope: 'building', startDate: '2099-09-01' });
      expect(future.status).toBe(201);
      expect(future.body.warning).toBeNull();
    });

    /** Posts `incoming` over `existing`, and returns the response and the dates and times saved. */
    const mergeOver = async (existing, incoming) => {
      db.respond = (sql) => {
        if (/SELECT \* FROM closures/.test(sql)) return { rows: [existing] };
        if (/UPDATE closures/.test(sql)) return { rows: [{ id: existing.id }] };
        return null;
      };
      const res = await createClosure({ scope: 'building', ...incoming });
      const [update] = sqlRan(/UPDATE closures/);
      const [startDate, endDate, startTime, endTime] = update.params;
      return { res, merged: { startDate, endDate, startTime, endTime } };
    };

    // The merged closure is the bounding box of both. Whether that is right when it widens a
    // part-day closure onto days it did not cover is an open product question.
    it('merges overlapping closures rather than creating duplicates', async () => {
      const { res, merged } = await mergeOver(
        { id: 1, start_date: '2026-11-10', end_date: '2026-11-12', start_time: '09:00:00', end_time: '13:00:00' },
        { startDate: '2026-11-11', endDate: '2026-11-15', startTime: '08:00', endTime: '12:00' }
      );

      expect(res.body.merged).toBe(true);
      expect(sqlRan(/INSERT INTO closures/)).toHaveLength(0);
      expect(merged.startDate).toBe('2026-11-10');
      expect(merged.endDate).toBe('2026-11-15');
      expect(merged.startTime).toBe('08:00');
      expect(merged.endTime).toBe('13:00');
    });

    it('keeps the earlier start time when the existing closure has it', async () => {
      const { merged } = await mergeOver(
        { id: 3, start_date: '2026-11-10', end_date: '2026-11-10', start_time: '08:00:00', end_time: '11:00:00' },
        { startDate: '2026-11-10', endDate: '2026-11-10', startTime: '10:00', endTime: '13:00' }
      );

      expect(merged.startTime).toBe('08:00');
      expect(merged.endTime).toBe('13:00');
    });

    it('merges multi-day full day closure by removing time constraints if either is whole-day', async () => {
      const { merged } = await mergeOver(
        { id: 2, start_date: '2026-11-10', end_date: '2026-11-12', start_time: '09:00:00', end_time: '13:00:00' },
        { startDate: '2026-11-12', endDate: '2026-11-13', startTime: null, endTime: null }
      );

      expect(merged.startTime).toBeNull();
      expect(merged.endTime).toBeNull();
      expect(merged.startDate).toBe('2026-11-10');
      expect(merged.endDate).toBe('2026-11-13');
    });

    it('stays whole-day when the existing closure is the whole-day one', async () => {
      const { merged } = await mergeOver(
        { id: 4, start_date: '2026-11-10', end_date: '2026-11-12', start_time: null, end_time: null },
        { startDate: '2026-11-12', endDate: '2026-11-13', startTime: '09:00', endTime: '13:00' }
      );

      expect(merged.startTime).toBeNull();
      expect(merged.endTime).toBeNull();
    });
  });

  describe('Term validation rules', () => {
    const batches = [{ id: 10, year: 2029 }, { id: 20, year: 2028 }, { id: 30, year: 2030 }];
    const existingTerms = [
      { id: 1, batch_id: 10, semester_number: 3, term_number: 5, start_date: '2026-08-01', end_date: '2026-10-28' },
      { id: 2, batch_id: 20, semester_number: 5, term_number: 9, start_date: '2026-08-01', end_date: '2026-10-28' },
    ];

    beforeEach(() => {
      db.respond = (sql, params) => {
        if (/FROM batches/.test(sql)) return { rows: selectWhere(sql, params, batches) };
        if (/SELECT \* FROM terms/.test(sql)) return { rows: selectWhere(sql, params, existingTerms) };
        if (/FROM terms/.test(sql)) return { rows: selectWhere(sql, params, existingTerms) };
        if (/INSERT INTO terms|UPDATE terms/.test(sql)) return { rows: [{ id: 99 }] };
        return null;
      };
    });

    const createTerm = (body) => send('POST', '/terms', { semesterNumber: 3, ...body });

    it('rejects overlapping terms of the SAME batch with 409', async () => {
      const res = await createTerm({
        batchYear: 2029,
        termNumber: 6,
        startDate: '2026-10-20', // overlaps with T5 end (Oct 28)
        endDate: '2027-01-31',
      });
      expect(res.status).toBe(409);
      expect(res.body.message).toContain('Term dates overlap with Term 5');
    });

    it('allows overlapping terms of DIFFERENT batches (cross-batch sharing building)', async () => {
      const res = await createTerm({
        batchYear: 2030,
        termNumber: 1,
        startDate: '2026-08-01',
        endDate: '2026-10-28',
      });
      expect(res.status).toBe(201);
    });

    it('allows consecutive terms of the same batch with no overlap', async () => {
      const res = await createTerm({
        batchYear: 2029,
        termNumber: 6,
        startDate: '2026-10-29', // Day after T5 ends
        endDate: '2027-01-31',
      });
      expect(res.status).toBe(201);
    });

    it('does not count a term being edited as overlapping itself', async () => {
      const res = await send('PUT', '/terms/1', { endDate: '2026-10-30' });
      expect(res.status).toBe(200);
    });
  });

  describe('Timetable row outside term validation', () => {
    const term = {
      id: 1, batch_id: 1, year: 2029, batch_year: 2029, term_number: 5, start_date: '2026-08-01', end_date: '2026-10-28',
    };
    const rooms = [{ id: 1, name: '1A', floor: '1st', parent_room_id: null }];

    /** Imports one class whose cell carries rowDate, and returns the importer's report. */
    const importRowDated = (rowDate) => {
      db.respond = respondForImport({ rooms, terms: [term] });
      const cell = `MERN - 2029, Grp A, (Mrinal), ${rowDate}, Classroom A 1st floor`;
      return importTimetable({
        buffer: buildTimetable([{ start: '10:00', end: '12:00', cell }]),
        buildingId: 1,
        termId: term.id,
        dryRun: true,
      });
    };

    it.each(['2026-09-15', '2026-08-01', '2026-10-28'])('accepts rows within term dates (%s)', async (rowDate) => {
      const report = await importRowDated(rowDate);
      expect(report.errors).toEqual([]);
      expect(report.savedCount).toBe(1);
    });

    it('rejects a timetable row dated before term start with row error', async () => {
      const report = await importRowDated('2026-07-31');
      expect(report.savedCount).toBe(0);
      expect(report.errors).toHaveLength(1);
      expect(report.errors[0].reason).toContain('outside term dates');
    });

    it('rejects a timetable row dated after term end with row error', async () => {
      const report = await importRowDated('2026-10-29');
      expect(report.savedCount).toBe(0);
      expect(report.errors).toHaveLength(1);
      expect(report.errors[0].reason).toContain('outside term dates');
    });
  });
});
