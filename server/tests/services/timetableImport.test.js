import { describe, it, expect } from 'vitest';
import XLSX from 'xlsx';
import {
  parseClassCell,
  parseTimeToMinutes,
  parseTimetableWorkbook,
  normalizeRoomKey,
  isIgnoredCell,
  minutesToTime,
  isPhysicalRoomLine,
} from '../../src/services/timetableImport.js';

function buildWorkbookBuffer() {
  const aoa = [
    ['Weekly Timetable'],
    ['Group A'],
    [null, 'Time', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
  ];

  for (let i = 0; i < 48; i += 1) {
    aoa.push([null, minutesToTime(540 + i * 15)]);
  }

  const sheet = XLSX.utils.aoa_to_sheet(aoa);

  sheet['C8'] = { t: 's', v: 'MERN - 2029, Grp A, (Mrinal), Classroom A 1st floor' };
  sheet['D8'] = { t: 's', v: 'Data Structures - 2029, Grp B, (Sharma), Classroom B 1st floor' };
  sheet['C20'] = { t: 's', v: 'Lunch' };
  sheet['C38'] = { t: 's', v: 'Academic Clubs, C groundfloor' };

  sheet['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: 50, c: 7 } });
  sheet['!merges'] = [
    { s: { r: 7, c: 2 }, e: { r: 14, c: 2 } },
    { s: { r: 7, c: 3 }, e: { r: 10, c: 3 } },
    { s: { r: 37, c: 2 }, e: { r: 46, c: 2 } },
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Weekly Schedule');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}

describe('parseClassCell', () => {
  it('extracts course, group, teacher, room, subject and entryType', () => {
    expect(parseClassCell('MERN - 2029, Grp A, (Mrinal), Classroom A 1st floor')).toEqual({
      course: 'MERN - 2029',
      subject: 'MERN',
      group: 'A',
      groups: ['A'],
      teacher: 'Mrinal',
      roomName: 'Classroom A 1st floor',
      entryType: 'class',
    });
  });

  it('handles a cell without a teacher and marks clubs', () => {
    expect(parseClassCell('Academic Clubs, C groundfloor')).toEqual({
      course: 'Academic Clubs',
      subject: 'Academic Clubs',
      group: null,
      groups: [],
      teacher: null,
      roomName: 'C groundfloor',
      entryType: 'club',
    });
  });

  it('detects lab entry type from LAB marker', () => {
    const res = parseClassCell('MERN - 2029\nGrp A LAB\n(Mrinal)\nClass A 1st floor');
    expect(res.entryType).toBe('lab');
    expect(res.subject).toBe('MERN');
    expect(res.groups).toEqual(['A']);
  });

  it('returns null for lunch and empty cells', () => {
    expect(parseClassCell('Lunch')).toBeNull();
    expect(parseClassCell('')).toBeNull();
    expect(parseClassCell(null)).toBeNull();
  });
});

describe('parseTimeToMinutes', () => {
  it('parses 12-hour, 24-hour and Excel serial times', () => {
    expect(parseTimeToMinutes('9:00 AM')).toBe(540);
    expect(parseTimeToMinutes('5:30 PM')).toBe(1050);
    expect(parseTimeToMinutes('09:00')).toBe(540);
    expect(parseTimeToMinutes('17.30')).toBe(1050);
    expect(parseTimeToMinutes(0.375)).toBe(540);
  });

  it('rejects values that are not times', () => {
    expect(parseTimeToMinutes('MERN - 2029')).toBeNull();
    expect(parseTimeToMinutes('2029')).toBeNull();
    expect(parseTimeToMinutes('13:99')).toBeNull();
  });
});

describe('room helpers', () => {
  it('normalizes aliases regardless of case and spacing', () => {
    expect(normalizeRoomKey('  Class A   1st Floor ')).toBe('class a 1st floor');
  });

  it('detects non-class cells', () => {
    expect(isIgnoredCell('Lunch')).toBe(true);
    expect(isIgnoredCell('Break')).toBe(true);
    expect(isIgnoredCell('MERN')).toBe(false);
  });
});

describe('parseTimetableWorkbook', () => {
  const result = parseTimetableWorkbook(buildWorkbookBuffer());

  it('reads the merged MERN block with the end time from its height', () => {
    const mern = result.classes.find((c) => c.course === 'MERN - 2029');
    expect(mern).toBeDefined();
    expect(mern.dayOfWeek).toBe(1);
    expect(mern.startTime).toBe('10:00');
    expect(mern.endTime).toBe('12:00');
    expect(mern.teacher).toBe('Mrinal');
    expect(mern.roomName).toBe('Classroom A 1st floor');
    expect(mern.group).toBe('A');
  });

  it('reads a four-row merged class as one hour', () => {
    const ds = result.classes.find((c) => c.course.startsWith('Data Structures'));
    expect(ds.startTime).toBe('10:00');
    expect(ds.endTime).toBe('11:00');
    expect(ds.dayOfWeek).toBe(2);
  });

  it('imports Academic Clubs with the ground-floor room and club entryType', () => {
    const clubs = result.classes.find((c) => c.course === 'Academic Clubs');
    expect(clubs).toBeDefined();
    expect(clubs.startTime).toBe('17:30');
    expect(clubs.endTime).toBe('20:00');
    expect(clubs.roomName).toBe('C groundfloor');
    expect(clubs.group).toBeNull();
    expect(clubs.entryType).toBe('club');
  });

  it('ignores lunch cells and reports no warnings for this sheet', () => {
    expect(result.classes.some((c) => c.course.toLowerCase() === 'lunch')).toBe(false);
    expect(result.warnings).toEqual([]);
  });

  it('only parses one class per merged block', () => {
    expect(result.classes).toHaveLength(3);
  });
});

describe('Sheet differences handling (C21)', () => {
  it('parses combined groups (Grp A+B)', () => {
    const parsed = parseClassCell('C++ - 2028\nGrp A+B\nclass C Ground floor');
    expect(parsed.groups).toEqual(['A', 'B']);
    expect(parsed.subject).toBe('C++');
    expect(parsed.roomName).toBe('class C Ground floor');
  });

  it('handles classes with no group (whole batch)', () => {
    const parsed = parseClassCell('Advance Graph Algorithms [HFT]\nClass B 1st floor');
    expect(parsed.groups).toEqual([]);
    expect(parsed.group).toBeNull();
    expect(parsed.subject).toBe('Advance Graph Algorithms');
    expect(parsed.roomName).toBe('Class B 1st floor');
  });

  it('handles FDE room in parentheses', () => {
    const parsed = parseClassCell('FDE (Classroom A, 2nd Floor)');
    expect(parsed.subject).toBe('FDE');
    expect(parsed.roomName).toBe('Classroom A, 2nd Floor');
    expect(parsed.teacher).toBeNull();
  });

  it('detects standalone Lab cell', () => {
    const parsed = parseClassCell('Lab');
    expect(parsed.isLabOnly).toBe(true);
    expect(parsed.entryType).toBe('lab');
  });

  it('handles Claas spelling typo in room name', () => {
    const parsed = parseClassCell('ICP - 2030\nGrp A\n(Akansha)\nClaas A 2nd floor');
    expect(parsed).toBeDefined();
    expect(parsed.roomName).toBe('Claas A 2nd floor');
    expect(parsed.teacher).toBe('Akansha');
    expect(parsed.groups).toEqual(['A']);
    expect(normalizeRoomKey(parsed.roomName)).toBe('class a 2nd floor');
  });

  it('handles Class B 2nd floor and Class B1 2nd floor', () => {
    const parsedB = parseClassCell('Web Dev - 2030 Grp A (Shubham) Class B 2nd floor');
    expect(parsedB).toBeDefined();
    expect(parsedB.roomName).toBe('Class B 2nd floor');
    expect(normalizeRoomKey(parsedB.roomName)).toBe('class b 2nd floor');

    const parsedB1 = parseClassCell('English - 2030 Grp C (Dr. Noor) Class B1 2nd floor');
    expect(parsedB1).toBeDefined();
    expect(parsedB1.roomName).toBe('Class B1 2nd floor');
    expect(normalizeRoomKey(parsedB1.roomName)).toBe('class b1 2nd floor');
  });

  it('correctly discriminates physical rooms from L&D track headers (isPhysicalRoomLine)', () => {
    expect(isPhysicalRoomLine('L&D Classroom 1 - DSA - 2028')).toBe(false);
    expect(isPhysicalRoomLine('L&D Classroom 2 - GenAI - 2028')).toBe(false);
    expect(isPhysicalRoomLine('L&D Classroom 3 - CS Fund. / LLD - 2028')).toBe(false);
    expect(isPhysicalRoomLine('Virtual Classroom')).toBe(false);

    expect(isPhysicalRoomLine('Classroom B1+B2 2nd Floor')).toBe(true);
    expect(isPhysicalRoomLine('Classroom A 1st floor')).toBe(true);
    expect(isPhysicalRoomLine('Classroom B 1st floor')).toBe(true);
    expect(isPhysicalRoomLine('Classroom C Ground floor')).toBe(true);
    expect(isPhysicalRoomLine('Classroom A 2nd floor')).toBe(true);
    expect(isPhysicalRoomLine('Classroom C 2nd floor')).toBe(true);
    expect(isPhysicalRoomLine('C groundfloor')).toBe(true);
  });

  it('correctly extracts physical room from cell with L&D course track on line 1', () => {
    const raw = 'L&D Classroom 1 - DSA - 2028\nGrp A\n(Pushkar)\nClassroom B1+B2 2nd Floor';
    const parsed = parseClassCell(raw);
    expect(parsed).toBeDefined();
    expect(parsed.roomName).toBe('Classroom B1+B2 2nd Floor');
    expect(parsed.course).toBe('L&D Classroom 1 - DSA - 2028');
    expect(parsed.teacher).toBe('Pushkar');
    expect(parsed.group).toBe('A');
  });

  it('correctly extracts course title when group is on the same line', () => {
    const raw = 'NLP & Transformers [AI/ML] LAB - 2028 Grp A\n(Manu Gupta)\nClassroom B1+B2 2nd Floor';
    const parsed = parseClassCell(raw);
    expect(parsed).toBeDefined();
    expect(parsed.course).toBe('NLP & Transformers [AI/ML] LAB - 2028');
    expect(parsed.teacher).toBe('Manu Gupta');
    expect(parsed.roomName).toBe('Classroom B1+B2 2nd Floor');
    expect(parsed.group).toBe('A');

    const mkt = 'Marketing Strategies - 2027 + 2028 Grp A+B \n(Kanika)\nClassroom B1+B2 2nd Floor';
    const parsedMkt = parseClassCell(mkt);
    expect(parsedMkt).toBeDefined();
    expect(parsedMkt.course).toBe('Marketing Strategies - 2027 + 2028');
    expect(parsedMkt.teacher).toBe('Kanika');
    expect(parsedMkt.roomName).toBe('Classroom B1+B2 2nd Floor');
    expect(parsedMkt.groups).toEqual(['A', 'B']);
  });

  it('handles L&D standalone lab continuation cells', () => {
    const raw = 'L&D Classroom 1 - DSA LAB';
    const parsed = parseClassCell(raw);
    expect(parsed.isLabOnly).toBe(true);
    expect(parsed.entryType).toBe('lab');
    expect(parsed.subject).toBe('DSA');
    expect(parsed.roomName).toBeNull();
  });
});
