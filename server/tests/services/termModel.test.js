/**
 * Term-related tests for the v2 data model (C3, C17), run against the real engine, admin routes,
 * parser, migration and importer. Only the database is faked.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/config/db.js', async () => (await import('../helpers/fakeDb.js')).fakeDbModule);

import { db, resetDb, selectWhere, sqlRan } from '../helpers/fakeDb.js';
import { buildTimetable, respondForImport, startRouter } from '../helpers/fixtures.js';
import migrate from '../../src/config/migrate.js';
import adminRouter from '../../src/routes/admin.js';
import { generateToken } from '../../src/middleware/auth.js';
import {
  evaluateDateAvailability,
  hasTimetableForDate,
  isDateInsideAnyTerm,
} from '../../src/services/availabilityEngine.js';
import { importTimetable, parseClassCell } from '../../src/services/timetableImport.js';

beforeEach(resetDb);

describe('Term date-range coverage (C3 / C5)', () => {
  const termT5 = { id: 1, batch_id: 1, start_date: '2026-08-01', end_date: '2026-10-28' };
  const termT6 = { id: 2, batch_id: 1, start_date: '2026-11-01', end_date: '2027-01-31' };

  /** Asks both ways the engine answers this: its SQL query and its in-memory term list. */
  async function covered(date, terms) {
    db.respond = (sql, params) => (/FROM terms WHERE/.test(sql) ? { rows: selectWhere(sql, params, terms) } : null);
    const fromSql = await hasTimetableForDate(1, date);
    expect(isDateInsideAnyTerm(date, terms)).toBe(fromSql);
    return fromSql;
  }

  it('date inside a term → covered', async () => {
    expect(await covered('2026-10-01', [termT5])).toBe(true);
    expect(await covered('2026-08-01', [termT5])).toBe(true); // start boundary inclusive
    expect(await covered('2026-10-28', [termT5])).toBe(true); // end boundary inclusive
  });

  it('date before the term → not covered', async () => {
    expect(await covered('2026-07-31', [termT5])).toBe(false);
  });

  it('date after the term → not covered', async () => {
    expect(await covered('2026-10-29', [termT5])).toBe(false);
  });

  it('date between two terms → unknown (no coverage)', async () => {
    // gap: Oct 29 to Oct 31
    expect(await covered('2026-10-29', [termT5, termT6])).toBe(false);
    expect(await covered('2026-10-31', [termT5, termT6])).toBe(false);
    expect(evaluateDateAvailability({ date: '2026-10-29', terms: [termT5, termT6] }).status).toBe('unknown');
  });

  it('date in first term → covered even when second exists', async () => {
    expect(await covered('2026-09-15', [termT5, termT6])).toBe(true);
  });

  it('date in second term → covered', async () => {
    expect(await covered('2026-11-15', [termT5, termT6])).toBe(true);
  });

  it('no terms → never covered', async () => {
    expect(await covered('2026-10-01', [])).toBe(false);
  });
});

describe('Same-batch term overlap validation (C11)', () => {
  const batches = [{ id: 1, year: 2029 }, { id: 2, year: 2028 }];
  const existing = { id: 1, batch_id: 1, term_number: 5, start_date: '2026-08-01', end_date: '2026-10-28' };
  let app;

  beforeAll(async () => {
    app = await startRouter(adminRouter);
  });
  afterAll(() => app.close());

  beforeEach(() => {
    db.respond = (sql, params) => {
      if (/FROM batches/.test(sql)) return { rows: selectWhere(sql, params, batches) };
      if (/FROM terms/.test(sql)) return { rows: selectWhere(sql, params, [existing]) };
      if (/INSERT INTO terms/.test(sql)) return { rows: [{ id: 99 }] };
      return null;
    };
  });

  const createTerm = async ({ batchYear = 2029, startDate, endDate }) => {
    const res = await fetch(`${app.url}/terms`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${generateToken({ id: 1, role: 'admin' })}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ batchYear, semesterNumber: 3, termNumber: 6, startDate, endDate }),
    });
    return { status: res.status, body: await res.json() };
  };

  it('non-overlapping new term passes', async () => {
    const res = await createTerm({ startDate: '2026-11-01', endDate: '2027-01-31' });
    expect(res.status).toBe(201);
  });

  it('touching terms (adjacent, not overlapping) passes', async () => {
    // end=Oct 28, start=Oct 29 → no overlap
    const res = await createTerm({ startDate: '2026-10-29', endDate: '2027-01-31' });
    expect(res.status).toBe(201);
  });

  it('overlapping new term is rejected', async () => {
    const res = await createTerm({ startDate: '2026-10-01', endDate: '2027-01-31' });
    expect(res.status).toBe(409);
    expect(sqlRan(/INSERT INTO terms/)).toHaveLength(0);
  });

  it('contained new term is rejected', async () => {
    const res = await createTerm({ startDate: '2026-09-01', endDate: '2026-09-30' });
    expect(res.status).toBe(409);
  });

  it('sharing just one boundary day is rejected', async () => {
    const startsOnLastDay = await createTerm({ startDate: '2026-10-28', endDate: '2027-01-31' });
    expect(startsOnLastDay.status).toBe(409);

    const endsOnFirstDay = await createTerm({ startDate: '2026-06-01', endDate: '2026-08-01' });
    expect(endsOnFirstDay.status).toBe(409);
  });

  it('identical date range is rejected (duplicate)', async () => {
    const res = await createTerm({ startDate: '2026-08-01', endDate: '2026-10-28' });
    expect(res.status).toBe(409);
  });

  it('different batch — overlap is allowed (cross-batch is a warning, not rejection)', async () => {
    // Two batches can share the same dates; only same-batch overlaps are errors.
    const res = await createTerm({ batchYear: 2028, startDate: '2026-08-01', endDate: '2026-10-28' });
    expect(res.status).toBe(201);
  });
});

describe('Entry type classification (C17)', () => {
  async function runMigration() {
    const previous = process.env.DATABASE_URL;
    process.env.DATABASE_URL = 'postgres://fake';
    const logged = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await migrate();
    } finally {
      logged.mockRestore();
      if (previous === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previous;
    }
  }

  /** The values allowed by the CHECK constraint the real migration creates. */
  async function allowedEntryTypes() {
    await runMigration();
    const [{ sql }] = sqlRan(/CREATE TABLE IF NOT EXISTS timetable_entries/);
    const [, list] = /CHECK \(entry_type IN \(([^)]*)\)\)/.exec(sql);
    return list.split(',').map((value) => value.trim().replace(/'/g, ''));
  }

  it('class, lab, and club are valid entry types', async () => {
    expect(await allowedEntryTypes()).toEqual(['class', 'lab', 'club']);

    // The parser produces exactly those.
    expect(parseClassCell('MERN - 2029, Grp A, (Mrinal), Classroom A 1st floor').entryType).toBe('class');
    expect(parseClassCell('MERN LAB - 2029, Grp A, (Mrinal), Classroom A 1st floor').entryType).toBe('lab');
    expect(parseClassCell('Academic Clubs, C groundfloor').entryType).toBe('club');
  });

  it('any other value is invalid', async () => {
    const allowed = await allowedEntryTypes();
    for (const type of ['exam', 'event', 'lecture', '', null]) {
      expect(allowed).not.toContain(type);
    }
  });

  describe('entry_type CHECK on databases upgraded through ALTER TABLE', () => {
    const ADD = /ADD CONSTRAINT timetable_entries_entry_type_check CHECK \(entry_type IN \('class', 'lab', 'club'\)\) NOT VALID/;
    const VALIDATE = /VALIDATE CONSTRAINT timetable_entries_entry_type_check/;

    /** Runs the migration with this constraint state and these rows, and returns what it warned. */
    async function migrateDatabase({ constraint = [], invalidRows = [] }) {
      db.respond = (sql) => {
        if (/FROM pg_constraint/.test(sql)) return { rows: constraint };
        if (/GROUP BY entry_type/.test(sql)) return { rows: invalidRows };
        return null;
      };
      const warned = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        await runMigration();
        return warned.mock.calls.flat().join(' ');
      } finally {
        warned.mockRestore();
      }
    }

    it('leaves a database that already has the validated check alone', async () => {
      const warning = await migrateDatabase({ constraint: [{ convalidated: true }] });

      expect(sqlRan(ADD)).toHaveLength(0);
      expect(sqlRan(VALIDATE)).toHaveLength(0);
      expect(sqlRan(/GROUP BY entry_type/)).toHaveLength(0);
      expect(warning).toBe('');
    });

    it('adds and validates the check when every row is valid', async () => {
      const warning = await migrateDatabase({});

      expect(sqlRan(ADD)).toHaveLength(1);
      expect(sqlRan(VALIDATE)).toHaveLength(1);
      expect(warning).toBe('');
    });

    it('reports other values without failing, validating or rewriting them', async () => {
      const warning = await migrateDatabase({ invalidRows: [{ entry_type: 'lecture', count: 3 }] });

      expect(warning).toContain('"lecture" (3)');
      expect(sqlRan(ADD)).toHaveLength(1);
      expect(sqlRan(VALIDATE)).toHaveLength(0);
      expect(sqlRan(/(UPDATE|DELETE FROM) timetable_entries/)).toHaveLength(0);
      expect(sqlRan(/^COMMIT$/)).toHaveLength(1);
    });

    it('validates the existing check once the other values are gone', async () => {
      const warning = await migrateDatabase({ constraint: [{ convalidated: false }] });

      expect(sqlRan(ADD)).toHaveLength(0);
      expect(sqlRan(VALIDATE)).toHaveLength(1);
      expect(warning).toBe('');
    });
  });

  /**
   * Lab cell rule (C21): a cell that says only "Lab" inherits subject, group and
   * room from the class above it in the same column and is saved with type "lab".
   * We test the detection logic here; the full importer handles the lookup.
   */
  it('detects a lab-only cell by its content', () => {
    const isLabOnlyCell = (value) => Boolean(parseClassCell(value)?.isLabOnly);

    expect(isLabOnlyCell('Lab')).toBe(true);
    expect(isLabOnlyCell('LAB')).toBe(true);
    expect(isLabOnlyCell('  Lab  ')).toBe(true);
    expect(isLabOnlyCell('MERN LAB')).toBe(false); // inline lab marker, not a standalone cell
    expect(isLabOnlyCell('Lunch')).toBe(false);
  });
});

const ROOMS = [
  { id: 1, name: '1A', floor: '1st', parent_room_id: null },
  { id: 6, name: 'C', floor: 'Ground', parent_room_id: null },
];
const MERN_CELL = 'MERN - 2029, Grp A, (Mrinal), Classroom A 1st floor';

/** The term_id, valid_from and valid_to of each saved timetable row. */
const savedEntries = () => sqlRan(/INSERT INTO timetable_entries/).map(({ params }) => ({
  term_id: params[1],
  entry_type: params[4],
  valid_from: params[11],
  valid_to: params[12],
}));

describe('Timetable upload batch and term association (C4)', () => {
  const termsDb = [
    { id: 1, batch_id: 1, year: 2029, batch_year: 2029, semester_number: 3, term_number: 5, start_date: '2026-08-01', end_date: '2026-10-28' },
    { id: 2, batch_id: 2, year: 2028, batch_year: 2028, semester_number: 5, term_number: 9, start_date: '2026-08-01', end_date: '2026-10-28' },
    { id: 3, batch_id: 1, year: 2029, batch_year: 2029, semester_number: 3, term_number: 6, start_date: '2026-11-01', end_date: '2027-01-31' },
  ];
  const buffer = buildTimetable([{ start: '10:00', end: '12:00', cell: MERN_CELL }]);

  beforeEach(() => {
    db.respond = respondForImport({ rooms: ROOMS, terms: termsDb });
  });

  it('resolves term dates when termId is provided', async () => {
    const report = await importTimetable({ buffer, buildingId: 1, termId: 1 });
    expect(report.committed).toBe(true);
    expect(savedEntries()).toEqual([
      { term_id: 1, entry_type: 'class', valid_from: '2026-08-01', valid_to: '2026-10-28' },
    ]);
  });

  it('resolves term by batch year and term number', async () => {
    await importTimetable({ buffer, buildingId: 1, batchYear: 2028, termNumber: 9 });
    expect(savedEntries().map((entry) => entry.term_id)).toEqual([2]);
  });

  it('preserves distinct terms for different batches on the same date span', async () => {
    await importTimetable({ buffer, buildingId: 1, batchYear: 2029, termNumber: 5 });
    await importTimetable({ buffer, buildingId: 1, batchYear: 2028, termNumber: 9 });
    await importTimetable({ buffer, buildingId: 1, batchYear: 2029, termNumber: 6 });

    expect(savedEntries().map((entry) => entry.term_id)).toEqual([1, 2, 3]);
  });

  it('associates imported entries with term_id', async () => {
    const report = await importTimetable({ buffer, buildingId: 1, termId: 1 });
    expect(report.savedCount).toBe(1);

    const [entry] = savedEntries();
    expect(entry.term_id).toBe(1);
    expect(entry.valid_from).toBe('2026-08-01');
  });
});

describe('Cross-batch checks and club deduplication (C22)', () => {
  const span = { start_date: '2026-08-01', end_date: '2026-10-28' };
  const terms = [
    { id: 1, batch_id: 1, year: 2029, batch_year: 2029, term_number: 5, ...span },
    { id: 2, batch_id: 2, year: 2028, batch_year: 2028, term_number: 9, ...span },
  ];
  const existingEntry = {
    term_id: 2,
    batch_id: 2,
    batch_year: 2028,
    building_id: 1,
    day_of_week: 1,
    valid_from: span.start_date,
    valid_to: span.end_date,
  };

  const existing2028 = {
    ...existingEntry,
    room_id: 1,
    course_name: 'DSA - 2028',
    teacher: 'Sharma',
    start_time: '10:00:00',
    end_time: '12:00:00',
    entry_type: 'class',
  };

  const existingClub = {
    ...existingEntry,
    room_id: 6, // Classroom C ground
    course_name: 'Academic Clubs',
    teacher: null,
    start_time: '17:30:00',
    end_time: '20:00:00',
    entry_type: 'club',
  };

  const upload = (termId, existing, classes) => {
    db.respond = respondForImport({ rooms: ROOMS, terms, existing });
    return importTimetable({ buffer: buildTimetable(classes), buildingId: 1, termId, dryRun: true });
  };

  it('overlapping classes from DIFFERENT batches become warnings, not errors', async () => {
    const report = await upload(1, [existing2028], [{ start: '11:00', end: '13:00', cell: MERN_CELL }]); // 1 = Batch 2029

    expect(report.errors).toEqual([]);
    expect(report.savedCount).toBe(1);
    expect(report.warnings).toHaveLength(1);
    expect(report.warnings[0].reason).toContain('Batch 2028');
  });

  it('overlapping classes from the SAME batch are errors', async () => {
    const report = await upload(2, [existing2028], [{ start: '11:00', end: '13:00', cell: MERN_CELL }]); // 2 = Batch 2028

    expect(report.committed).toBe(false);
    expect(report.savedCount).toBe(0);
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0].reason).toContain('Time clash');
  });

  it('identical club events appearing in multiple sheets are deduplicated', async () => {
    const report = await upload(1, [existingClub], [{ start: '17:30', end: '20:00', cell: 'Academic Clubs, C groundfloor' }]);

    expect(report.errors).toEqual([]);
    expect(report.savedCount).toBe(0);
    expect(report.duplicateCount).toBe(1);
  });
});
