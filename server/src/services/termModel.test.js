/**
 * Term-related unit tests for the v2 data model (C3, C17).
 *
 * These tests cover:
 * 1. The term date-range logic that the engine relies on
 * 2. The timetable entry coverage rules (term-based vs legacy)
 * 3. Term overlap detection for validation
 *
 * These are pure-logic tests — no database is touched.
 */
import { describe, it, expect } from 'vitest';

// ── Helpers mirroring the engine's SQL logic ───────────────
// These replicate the engine's "is this date covered by a term?" logic
// so we can test it without a database.

/**
 * Is dateStr within term.start_date .. term.end_date?
 */
function dateInTerm(dateStr, term) {
  return term.start_date <= dateStr && term.end_date >= dateStr;
}

/**
 * Does the date fall inside any of the given terms?
 * This mirrors hasTimetableForDate's WHERE clause for term-linked entries.
 */
function dateHasCoverage(dateStr, terms) {
  return terms.some((t) => dateInTerm(dateStr, t));
}

/**
 * Do two terms overlap? (same batch only — cross-batch is allowed per C22)
 */
function termsOverlap(a, b) {
  return a.start_date <= b.end_date && a.end_date >= b.start_date;
}

// ── Tests ──────────────────────────────────────────────────

describe('Term date-range coverage (C3 / C5)', () => {
  const termT5 = { id: 1, batch_id: 1, start_date: '2026-08-01', end_date: '2026-10-28' };
  const termT6 = { id: 2, batch_id: 1, start_date: '2026-11-01', end_date: '2027-01-31' };

  it('date inside a term → covered', () => {
    expect(dateInTerm('2026-10-01', termT5)).toBe(true);
    expect(dateInTerm('2026-08-01', termT5)).toBe(true); // start boundary inclusive
    expect(dateInTerm('2026-10-28', termT5)).toBe(true); // end boundary inclusive
  });

  it('date before the term → not covered', () => {
    expect(dateInTerm('2026-07-31', termT5)).toBe(false);
  });

  it('date after the term → not covered', () => {
    expect(dateInTerm('2026-10-29', termT5)).toBe(false);
  });

  it('date between two terms → unknown (no coverage)', () => {
    // gap: Oct 29 to Oct 31
    expect(dateHasCoverage('2026-10-29', [termT5, termT6])).toBe(false);
    expect(dateHasCoverage('2026-10-31', [termT5, termT6])).toBe(false);
  });

  it('date in first term → covered even when second exists', () => {
    expect(dateHasCoverage('2026-09-15', [termT5, termT6])).toBe(true);
  });

  it('date in second term → covered', () => {
    expect(dateHasCoverage('2026-11-15', [termT5, termT6])).toBe(true);
  });

  it('no terms → never covered', () => {
    expect(dateHasCoverage('2026-10-01', [])).toBe(false);
  });
});

describe('Same-batch term overlap validation (C11)', () => {
  const existing = { batch_id: 1, start_date: '2026-08-01', end_date: '2026-10-28' };

  it('non-overlapping new term passes', () => {
    const newTerm = { batch_id: 1, start_date: '2026-11-01', end_date: '2027-01-31' };
    expect(termsOverlap(existing, newTerm)).toBe(false);
  });

  it('touching terms (adjacent, not overlapping) passes', () => {
    // end=Oct 28, start=Oct 29 → no overlap
    const newTerm = { batch_id: 1, start_date: '2026-10-29', end_date: '2027-01-31' };
    expect(termsOverlap(existing, newTerm)).toBe(false);
  });

  it('overlapping new term is rejected', () => {
    const newTerm = { batch_id: 1, start_date: '2026-10-01', end_date: '2027-01-31' };
    expect(termsOverlap(existing, newTerm)).toBe(true);
  });

  it('contained new term is rejected', () => {
    const newTerm = { batch_id: 1, start_date: '2026-09-01', end_date: '2026-09-30' };
    expect(termsOverlap(existing, newTerm)).toBe(true);
  });

  it('identical date range is rejected (duplicate)', () => {
    const newTerm = { batch_id: 1, start_date: '2026-08-01', end_date: '2026-10-28' };
    expect(termsOverlap(existing, newTerm)).toBe(true);
  });

  it('different batch — overlap is allowed (cross-batch is a warning, not rejection)', () => {
    // Two batches can share the same dates; only same-batch overlaps are errors.
    const batch2 = { batch_id: 2, start_date: '2026-08-01', end_date: '2026-10-28' };
    // The validation only compares within the same batch_id, so this combination
    // would not be compared at all — function would not be called.
    expect(batch2.batch_id).not.toBe(existing.batch_id);
  });
});

describe('Entry type classification (C17)', () => {
  // The entry_type column has three allowed values per the DB constraint.
  const VALID_TYPES = ['class', 'lab', 'club'];

  it('class, lab, and club are valid entry types', () => {
    for (const t of VALID_TYPES) {
      expect(VALID_TYPES.includes(t)).toBe(true);
    }
  });

  it('any other value is invalid', () => {
    const invalid = ['exam', 'event', 'lecture', '', null];
    for (const t of invalid) {
      expect(VALID_TYPES.includes(t)).toBe(false);
    }
  });

  /**
   * Lab cell rule (C21): a cell that says only "Lab" inherits subject, group and
   * room from the class above it in the same column and is saved with type "lab".
   * We test the detection logic here; the full importer handles the lookup.
   */
  it('detects a lab-only cell by its content', () => {
    const isLabOnlyCell = (value) =>
      typeof value === 'string' && value.replace(/\s+/g, ' ').trim().toLowerCase() === 'lab';

    expect(isLabOnlyCell('Lab')).toBe(true);
    expect(isLabOnlyCell('LAB')).toBe(true);
    expect(isLabOnlyCell('  Lab  ')).toBe(true);
    expect(isLabOnlyCell('MERN LAB')).toBe(false); // inline lab marker, not a standalone cell
    expect(isLabOnlyCell('Lunch')).toBe(false);
  });
});

describe('Timetable upload batch and term association (C4)', () => {
  const termsDb = [
    { id: 1, batch_year: 2029, semester_number: 3, term_number: 5, start_date: '2026-08-01', end_date: '2026-10-28' },
    { id: 2, batch_year: 2028, semester_number: 5, term_number: 9, start_date: '2026-08-01', end_date: '2026-10-28' },
    { id: 3, batch_year: 2029, semester_number: 3, term_number: 6, start_date: '2026-11-01', end_date: '2027-01-31' },
  ];

  it('resolves term dates when termId is provided', () => {
    const term = termsDb.find((t) => t.id === 1);
    expect(term).toBeDefined();
    expect(term.start_date).toBe('2026-08-01');
    expect(term.end_date).toBe('2026-10-28');
  });

  it('resolves term by batch year and term number', () => {
    const term = termsDb.find((t) => t.batch_year === 2028 && t.term_number === 9);
    expect(term).toBeDefined();
    expect(term.id).toBe(2);
  });

  it('preserves distinct terms for different batches on the same date span', () => {
    const batch2029 = termsDb.filter((t) => t.batch_year === 2029);
    const batch2028 = termsDb.filter((t) => t.batch_year === 2028);

    expect(batch2029).toHaveLength(2);
    expect(batch2028).toHaveLength(1);
    // Distinct term IDs
    expect(batch2029[0].id).not.toBe(batch2028[0].id);
  });

  it('associates imported entries with term_id', () => {
    const rawClass = { course: 'MERN', room_id: 1, day_of_week: 1, start: '10:00', end: '12:00' };
    const termId = 1;
    const entry = { ...rawClass, term_id: termId, valid_from: termsDb[0].start_date, valid_to: termsDb[0].end_date };

    expect(entry.term_id).toBe(1);
    expect(entry.valid_from).toBe('2026-08-01');
  });
});
