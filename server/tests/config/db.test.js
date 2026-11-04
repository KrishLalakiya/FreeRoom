import { describe, expect, it } from 'vitest';
import pg from 'pg';
import '../../src/config/db.js';
import { toDateStr } from '../../src/utils/timezone.js';

describe('DATE columns', () => {
  const DATE_OID = 1082;

  it('stay calendar-date strings instead of shifting a day through a local-midnight Date', () => {
    const parse = pg.types.getTypeParser(DATE_OID);
    expect(parse('2026-10-29')).toBe('2026-10-29');
  });

  it('pass through toDateStr unchanged', () => {
    expect(toDateStr('2026-10-29')).toBe('2026-10-29');
  });

  it('toDateStr still converts real instants to the campus date', () => {
    expect(toDateStr(new Date('2026-10-28T18:30:00.000Z'), 'Asia/Kolkata')).toBe('2026-10-29');
  });
});
