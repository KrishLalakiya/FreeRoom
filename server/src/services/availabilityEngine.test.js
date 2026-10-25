import { describe, it, expect } from 'vitest';
import { mergeOverlapping, computeFreeIntervals } from './availabilityEngine.js';

/**
 * Helper: create a Date from a time string on a fixed day (2026-10-26)
 * in UTC (the engine works in UTC internally).
 */
function utc(time) {
  return new Date(`2026-10-26T${time}:00Z`);
}

// ── mergeOverlapping ───────────────────────────────────────

describe('mergeOverlapping', () => {
  it('returns empty for empty input', () => {
    expect(mergeOverlapping([])).toEqual([]);
  });

  it('returns one block unchanged', () => {
    const blocks = [{ start: utc('09:00'), end: utc('10:00'), title: 'MERN' }];
    const merged = mergeOverlapping(blocks);
    expect(merged).toHaveLength(1);
    expect(merged[0].title).toBe('MERN');
  });

  it('merges two overlapping blocks', () => {
    const blocks = [
      { start: utc('09:00'), end: utc('10:30'), title: 'A' },
      { start: utc('10:00'), end: utc('11:00'), title: 'B' },
    ];
    const merged = mergeOverlapping(blocks);
    expect(merged).toHaveLength(1);
    expect(merged[0].start).toEqual(utc('09:00'));
    expect(merged[0].end).toEqual(utc('11:00'));
  });

  it('merges touching blocks (end === start)', () => {
    const blocks = [
      { start: utc('09:00'), end: utc('10:00'), title: 'A' },
      { start: utc('10:00'), end: utc('11:00'), title: 'B' },
    ];
    const merged = mergeOverlapping(blocks);
    expect(merged).toHaveLength(1);
    expect(merged[0].end).toEqual(utc('11:00'));
  });

  it('does not merge non-overlapping blocks', () => {
    const blocks = [
      { start: utc('09:00'), end: utc('10:00'), title: 'A' },
      { start: utc('11:00'), end: utc('12:00'), title: 'B' },
    ];
    const merged = mergeOverlapping(blocks);
    expect(merged).toHaveLength(2);
  });

  it('handles unordered input', () => {
    const blocks = [
      { start: utc('14:00'), end: utc('15:00'), title: 'Later' },
      { start: utc('09:00'), end: utc('10:00'), title: 'Earlier' },
    ];
    const merged = mergeOverlapping(blocks);
    expect(merged).toHaveLength(2);
    expect(merged[0].title).toBe('Earlier');
    expect(merged[1].title).toBe('Later');
  });

  it('merges multiple overlapping into one', () => {
    const blocks = [
      { start: utc('09:00'), end: utc('10:00'), title: 'A' },
      { start: utc('09:30'), end: utc('11:00'), title: 'B' },
      { start: utc('10:45'), end: utc('12:00'), title: 'C' },
    ];
    const merged = mergeOverlapping(blocks);
    expect(merged).toHaveLength(1);
    expect(merged[0].start).toEqual(utc('09:00'));
    expect(merged[0].end).toEqual(utc('12:00'));
  });
});

// ── computeFreeIntervals ───────────────────────────────────

describe('computeFreeIntervals', () => {
  // Building hours: 06:00 to 22:00 (C1)
  const dayStart = utc('06:00');
  const dayEnd = utc('22:00');

  it('whole day is free when there are no busy blocks', () => {
    const free = computeFreeIntervals([], dayStart, dayEnd);
    expect(free).toHaveLength(1);
    expect(free[0].start).toEqual(dayStart);
    expect(free[0].end).toEqual(dayEnd);
  });

  it('free before and after a single class', () => {
    const busy = [{ start: utc('10:00'), end: utc('12:00') }];
    const free = computeFreeIntervals(busy, dayStart, dayEnd);
    expect(free).toHaveLength(2);
    // 06:00 → 10:00
    expect(free[0].start).toEqual(utc('06:00'));
    expect(free[0].end).toEqual(utc('10:00'));
    // 12:00 → 22:00  (free until closing, per C1)
    expect(free[1].start).toEqual(utc('12:00'));
    expect(free[1].end).toEqual(utc('22:00'));
  });

  it('after the last class the room is free until 22:00 (C1)', () => {
    const busy = [{ start: utc('16:00'), end: utc('18:00') }];
    const free = computeFreeIntervals(busy, dayStart, dayEnd);
    const lastFree = free[free.length - 1];
    expect(lastFree.start).toEqual(utc('18:00'));
    expect(lastFree.end).toEqual(utc('22:00'));
  });

  it('no free time when busy covers the whole day', () => {
    const busy = [{ start: utc('06:00'), end: utc('22:00') }];
    const free = computeFreeIntervals(busy, dayStart, dayEnd);
    expect(free).toHaveLength(0);
  });

  it('gap between two classes', () => {
    const busy = [
      { start: utc('08:00'), end: utc('10:00') },
      { start: utc('14:00'), end: utc('16:00') },
    ];
    const free = computeFreeIntervals(busy, dayStart, dayEnd);
    expect(free).toHaveLength(3);
    // 06:00→08:00, 10:00→14:00, 16:00→22:00
    expect(free[0]).toEqual({ start: utc('06:00'), end: utc('08:00') });
    expect(free[1]).toEqual({ start: utc('10:00'), end: utc('14:00') });
    expect(free[2]).toEqual({ start: utc('16:00'), end: utc('22:00') });
  });

  it('class starting at opening leaves no early gap', () => {
    const busy = [{ start: utc('06:00'), end: utc('08:00') }];
    const free = computeFreeIntervals(busy, dayStart, dayEnd);
    expect(free).toHaveLength(1);
    expect(free[0].start).toEqual(utc('08:00'));
    expect(free[0].end).toEqual(utc('22:00'));
  });

  it('class ending at closing leaves no late gap', () => {
    const busy = [{ start: utc('20:00'), end: utc('22:00') }];
    const free = computeFreeIntervals(busy, dayStart, dayEnd);
    expect(free).toHaveLength(1);
    expect(free[0].start).toEqual(utc('06:00'));
    expect(free[0].end).toEqual(utc('20:00'));
  });
});
