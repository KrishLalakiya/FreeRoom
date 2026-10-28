import { describe, it, expect } from 'vitest';
import {
  zonedTimeToUtc,
  toDateStr,
  dayOfWeekForDateStr,
  addDaysToDateStr,
  isValidDateStr,
  getOffsetMinutes,
} from '../../src/utils/timezone.js';

describe('campus timezone helpers', () => {
  const TZ = 'Asia/Kolkata';

  it('converts campus wall-clock time to the correct UTC instant', () => {
    expect(zonedTimeToUtc('2026-10-21', '09:00', TZ).toISOString()).toBe(
      '2026-10-21T03:30:00.000Z'
    );
    expect(zonedTimeToUtc('2026-10-21', '20:00:00', TZ).toISOString()).toBe(
      '2026-10-21T14:30:00.000Z'
    );
  });

  it('derives the campus calendar date across the UTC midnight boundary', () => {
    expect(toDateStr(new Date('2026-10-21T20:00:00Z'), TZ)).toBe('2026-10-22');
    expect(toDateStr(new Date('2026-10-21T18:29:00Z'), TZ)).toBe('2026-10-21');
  });

  it('derives the weekday from the campus date, not server time', () => {
    expect(dayOfWeekForDateStr('2026-10-21')).toBe(3);
    expect(dayOfWeekForDateStr('2026-10-25')).toBe(0);
  });

  it('reports the Asia/Kolkata offset as 330 minutes', () => {
    expect(getOffsetMinutes(TZ, new Date('2026-10-21T00:00:00Z'))).toBe(330);
  });

  it('adds days across month and year boundaries', () => {
    expect(addDaysToDateStr('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDaysToDateStr('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDaysToDateStr('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('rejects impossible calendar dates', () => {
    expect(isValidDateStr('2026-10-21')).toBe(true);
    expect(isValidDateStr('2026-02-30')).toBe(false);
    expect(isValidDateStr('2026-13-01')).toBe(false);
    expect(isValidDateStr('21-10-2026')).toBe(false);
  });
});
