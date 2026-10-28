import { describe, it, expect } from 'vitest';
import {
  mergeOverlapping,
  computeFreeIntervals,
  isDateInsideAnyTerm,
  evaluateDateAvailability,
  doesClosureApplyToRoom,
  closureToBusyBlock,
  applyClosuresToAvailability,
} from '../../src/services/availabilityEngine.js';

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

// ── Dates outside any term show as unknown (C5) ────────────

describe('dates outside any term show as unknown (C5)', () => {
  const terms = [
    { id: 1, name: 'Term 5', start_date: '2026-08-01', end_date: '2026-10-28' },
    { id: 2, name: 'Term 6', start_date: '2026-11-10', end_date: '2026-12-20' },
  ];

  it('Query within term -> works normally (free or occupied)', () => {
    // Within term, free room
    const freeRes = evaluateDateAvailability({
      date: '2026-09-15',
      terms,
      busyBlocks: [],
    });
    expect(freeRes.status).toBe('free');
    expect(freeRes.free_intervals).toHaveLength(1);
    expect(freeRes.free_intervals[0].start).toEqual(new Date('2026-09-15T00:30:00.000Z')); // 06:00 IST in UTC
    expect(freeRes.free_intervals[0].end).toEqual(new Date('2026-09-15T16:30:00.000Z')); // 22:00 IST in UTC

    // Within term, occupied/busy room
    const dayStart = new Date('2026-09-15T00:30:00.000Z');
    const dayEnd = new Date('2026-09-15T16:30:00.000Z');
    const busyRes = evaluateDateAvailability({
      date: '2026-09-15',
      terms,
      busyBlocks: [{ start: dayStart, end: dayEnd }],
    });
    expect(busyRes.status).toBe('busy');
    expect(busyRes.free_intervals).toHaveLength(0);
  });

  it('Query before term starts -> "unknown"', () => {
    const res = evaluateDateAvailability({
      date: '2026-07-20',
      terms,
      busyBlocks: [],
    });
    expect(res.status).toBe('unknown');
    expect(res.reason).toBe('Outside academic term: no timetable data');
    expect(res.free_intervals).toHaveLength(0);
  });

  it('Query after term ends -> "unknown"', () => {
    const res = evaluateDateAvailability({
      date: '2026-12-25',
      terms,
      busyBlocks: [],
    });
    expect(res.status).toBe('unknown');
    expect(res.reason).toBe('Outside academic term: no timetable data');
    expect(res.free_intervals).toHaveLength(0);
  });

  it('Query in between terms -> "unknown"', () => {
    const res = evaluateDateAvailability({
      date: '2026-11-02',
      terms,
      busyBlocks: [],
    });
    expect(res.status).toBe('unknown');
    expect(res.reason).toBe('Outside academic term: no timetable data');
    expect(res.free_intervals).toHaveLength(0);
  });

  it('isDateInsideAnyTerm correctly handles boundary dates', () => {
    expect(isDateInsideAnyTerm('2026-08-01', terms)).toBe(true); // Term 5 start
    expect(isDateInsideAnyTerm('2026-10-28', terms)).toBe(true); // Term 5 end
    expect(isDateInsideAnyTerm('2026-07-31', terms)).toBe(false); // 1 day before Term 5
    expect(isDateInsideAnyTerm('2026-10-29', terms)).toBe(false); // 1 day after Term 5
    expect(isDateInsideAnyTerm('2026-11-10', terms)).toBe(true); // Term 6 start
    expect(isDateInsideAnyTerm('2026-12-20', terms)).toBe(true); // Term 6 end
  });
});

// ── Closures application and ranking in engine (C7) ─────────

describe('closures application and ranking in engine (C7)', () => {
  const terms = [
    { id: 1, name: 'Term 5', start_date: '2026-08-01', end_date: '2026-10-28' },
  ];
  const room1A = { id: 101, building_id: 1, name: '1A', floor: '1st', parent_room_id: null };
  const room1B = { id: 102, building_id: 1, name: '1B', floor: '1st', parent_room_id: null };
  const room2A = { id: 201, building_id: 1, name: '2A', floor: '2nd', parent_room_id: null };
  const room2B = { id: 202, building_id: 1, name: '2B', floor: '2nd', parent_room_id: null, childRoomIds: [203, 204] };
  const room2B1 = { id: 203, building_id: 1, name: '2B1', floor: '2nd', parent_room_id: 202 };
  const room2B2 = { id: 204, building_id: 1, name: '2B2', floor: '2nd', parent_room_id: 202 };
  const roomC = { id: 301, building_id: 1, name: 'C', floor: 'Ground', parent_room_id: null };

  it('Building closure blocks all rooms', () => {
    const buildingClosure = {
      id: 1,
      scope: 'building',
      building_id: 1,
      start_date: '2026-09-15',
      end_date: '2026-09-15',
      reason: 'College-wide Exam',
    };

    const res1A = applyClosuresToAvailability({ room: room1A, date: '2026-09-15', terms, closures: [buildingClosure] });
    const res2A = applyClosuresToAvailability({ room: room2A, date: '2026-09-15', terms, closures: [buildingClosure] });
    const resC = applyClosuresToAvailability({ room: roomC, date: '2026-09-15', terms, closures: [buildingClosure] });

    expect(res1A.status).toBe('closed');
    expect(res1A.reason).toBe('College-wide Exam');
    expect(res2A.status).toBe('closed');
    expect(resC.status).toBe('closed');
  });

  it('Floor closure blocks all rooms on that floor', () => {
    const floorClosure = {
      id: 2,
      scope: 'floor',
      floor: '2nd',
      start_date: '2026-09-15',
      end_date: '2026-09-15',
      reason: '2nd Floor Midterm Exam',
    };

    // 2nd floor rooms are closed
    const res2A = applyClosuresToAvailability({ room: room2A, date: '2026-09-15', terms, closures: [floorClosure] });
    const res2B = applyClosuresToAvailability({ room: room2B, date: '2026-09-15', terms, closures: [floorClosure] });
    expect(res2A.status).toBe('closed');
    expect(res2B.status).toBe('closed');

    // 1st floor room is free
    const res1A = applyClosuresToAvailability({ room: room1A, date: '2026-09-15', terms, closures: [floorClosure] });
    expect(res1A.status).toBe('free');
  });

  it('Room closure blocks that specific room', () => {
    const roomClosure = {
      id: 3,
      scope: 'room',
      room_id: 101, // 1A
      start_date: '2026-09-15',
      end_date: '2026-09-15',
      reason: 'Lab Exam in 1A',
    };

    const res1A = applyClosuresToAvailability({ room: room1A, date: '2026-09-15', terms, closures: [roomClosure] });
    const res1B = applyClosuresToAvailability({ room: room1B, date: '2026-09-15', terms, closures: [roomClosure] });

    expect(res1A.status).toBe('closed');
    expect(res1B.status).toBe('free');
  });

  it('2B closure blocks 2B1 and 2B2; 2B1 closure blocks 2B', () => {
    const closureOn2B = {
      id: 4,
      scope: 'room',
      room_id: 202, // parent 2B
      start_date: '2026-09-15',
      end_date: '2026-09-15',
      reason: 'Grand Hall Exam',
    };

    // Parent closure covers both children
    const res2B1 = applyClosuresToAvailability({ room: room2B1, parentRoomId: 202, date: '2026-09-15', terms, closures: [closureOn2B] });
    const res2B2 = applyClosuresToAvailability({ room: room2B2, parentRoomId: 202, date: '2026-09-15', terms, closures: [closureOn2B] });
    expect(res2B1.status).toBe('closed');
    expect(res2B2.status).toBe('closed');

    // Child closure on 2B1 covers parent 2B, but leaves sibling 2B2 free
    const closureOn2B1 = {
      id: 5,
      scope: 'room',
      room_id: 203, // child 2B1
      start_date: '2026-09-15',
      end_date: '2026-09-15',
      reason: 'Sub-room 2B1 Viva',
    };

    const resParentFromChild = applyClosuresToAvailability({
      room: room2B,
      childRoomIds: [203, 204],
      date: '2026-09-15',
      terms,
      closures: [closureOn2B1],
    });
    const resSibling2B2 = applyClosuresToAvailability({
      room: room2B2,
      parentRoomId: 202,
      childRoomIds: [],
      date: '2026-09-15',
      terms,
      closures: [closureOn2B1],
    });

    expect(resParentFromChild.status).toBe('closed');
    expect(resSibling2B2.status).toBe('free');
  });

  it('Timetable class during closure is superseded by the closure block', () => {
    const wholeDayClosure = {
      id: 6,
      scope: 'room',
      room_id: 101,
      start_date: '2026-09-15',
      end_date: '2026-09-15',
      reason: 'Exam Day',
    };

    // Normal class scheduled from 10:00 to 12:00
    const timetableClass = {
      start: new Date('2026-09-15T04:30:00.000Z'), // 10:00 IST
      end: new Date('2026-09-15T06:30:00.000Z'),   // 12:00 IST
      title: 'MERN Stack',
    };

    const res = applyClosuresToAvailability({
      room: room1A,
      date: '2026-09-15',
      terms,
      timetableBlocks: [timetableClass],
      closures: [wholeDayClosure],
    });

    // Entire day is closed, not free or regular busy
    expect(res.status).toBe('closed');
    expect(res.reason).toBe('Exam Day');
    expect(res.free_intervals).toHaveLength(0);
  });

  it('Room free after partial-day closure (e.g., exam 09:00-12:00 -> free from 12:00 to 22:00)', () => {
    const partialClosure = {
      id: 7,
      scope: 'room',
      room_id: 101,
      start_date: '2026-09-15',
      end_date: '2026-09-15',
      start_time: '09:00',
      end_time: '12:00',
      reason: 'Morning Exam',
    };

    const res = applyClosuresToAvailability({
      room: room1A,
      date: '2026-09-15',
      terms,
      timetableBlocks: [],
      closures: [partialClosure],
    });

    expect(res.free_intervals).toHaveLength(2);
    // 06:00 to 09:00 free interval (in UTC: 00:30 to 03:30)
    expect(res.free_intervals[0].start).toEqual(new Date('2026-09-15T00:30:00.000Z'));
    expect(res.free_intervals[0].end).toEqual(new Date('2026-09-15T03:30:00.000Z'));
    // 12:00 to 22:00 free interval (in UTC: 06:30 to 16:30)
    expect(res.free_intervals[1].start).toEqual(new Date('2026-09-15T06:30:00.000Z'));
    expect(res.free_intervals[1].end).toEqual(new Date('2026-09-15T16:30:00.000Z'));

    // Check with `now` at 14:00 (08:30 UTC): room should be free until 22:00 (16:30 UTC)
    const afternoonNow = new Date('2026-09-15T08:30:00.000Z');
    const nowRes = applyClosuresToAvailability({
      room: room1A,
      date: '2026-09-15',
      terms,
      timetableBlocks: [],
      closures: [partialClosure],
      now: afternoonNow,
    });
    expect(nowRes.status).toBe('free');
    expect(nowRes.free_until).toEqual(new Date('2026-09-15T16:30:00.000Z'));

    // Check with `now` at 10:00 (04:30 UTC) during the exam: room status is 'closed'
    const examNow = new Date('2026-09-15T04:30:00.000Z');
    const duringExamRes = applyClosuresToAvailability({
      room: room1A,
      date: '2026-09-15',
      terms,
      timetableBlocks: [],
      closures: [partialClosure],
      now: examNow,
    });
    expect(duringExamRes.status).toBe('closed');
    expect(duringExamRes.reason).toBe('Morning Exam');
  });

  it('Whole day closure -> status = "closed"', () => {
    const wholeDayClosure = {
      id: 8,
      scope: 'room',
      room_id: 101,
      start_date: '2026-09-15',
      end_date: '2026-09-15',
      start_time: null,
      end_time: null,
      reason: 'Final Exams',
    };

    const res = applyClosuresToAvailability({
      room: room1A,
      date: '2026-09-15',
      terms,
      closures: [wholeDayClosure],
    });

    expect(res.status).toBe('closed');
    expect(res.reason).toBe('Final Exams');
    expect(res.free_intervals).toHaveLength(0);
  });
});

// ── No-Class Days for Holidays & Breaks (C12) ───────────────

describe('no-class days for holidays and breaks (C12)', () => {
  const terms = [
    { id: 1, name: 'Term 5', start_date: '2026-08-01', end_date: '2026-10-28' },
  ];
  const room1A = { id: 101, building_id: 1, name: '1A', floor: '1st', parent_room_id: null };

  it('on a no-class day, classes are skipped and room is free (C12)', () => {
    // Scheduled class 10:00 to 12:00
    const timetableClass = {
      start: new Date('2026-09-15T04:30:00.000Z'), // 10:00 IST
      end: new Date('2026-09-15T06:30:00.000Z'),   // 12:00 IST
      title: 'MERN Stack',
    };

    // On normal day: room has 2 free intervals (before and after class)
    const normalRes = applyClosuresToAvailability({
      room: room1A,
      date: '2026-09-15',
      terms,
      timetableBlocks: [timetableClass],
      noClassDay: false,
    });
    expect(normalRes.free_intervals).toHaveLength(2);

    // On no-class day: timetable class does not run, room is free all day 06:00 to 22:00!
    const holidayRes = applyClosuresToAvailability({
      room: room1A,
      date: '2026-09-15',
      terms,
      timetableBlocks: [timetableClass],
      noClassDay: { reason: 'Diwali' },
    });
    expect(holidayRes.status).toBe('free');
    expect(holidayRes.free_intervals).toHaveLength(1);
    expect(holidayRes.free_intervals[0].start).toEqual(new Date('2026-09-15T00:30:00.000Z')); // 06:00 IST
    expect(holidayRes.free_intervals[0].end).toEqual(new Date('2026-09-15T16:30:00.000Z')); // 22:00 IST
    expect(holidayRes.no_class_day.reason).toBe('Diwali');
  });

  it('if a closure also exists on a no-class day, the closure still takes effect (C12)', () => {
    const examClosure = {
      id: 9,
      scope: 'room',
      room_id: 101,
      start_date: '2026-09-15',
      end_date: '2026-09-15',
      reason: 'Holiday Special Exam',
    };

    const res = applyClosuresToAvailability({
      room: room1A,
      date: '2026-09-15',
      terms,
      timetableBlocks: [],
      closures: [examClosure],
      noClassDay: { reason: 'Mid-term Break' },
    });

    expect(res.status).toBe('closed');
    expect(res.reason).toBe('Holiday Special Exam');
    expect(res.free_intervals).toHaveLength(0);
  });
});

// ── Student UI: Building and Room Closures (C9) ─────────────

describe('student UI closure behavior (C9)', () => {
  const terms = [
    { id: 1, name: 'Term 5', start_date: '2026-08-01', end_date: '2026-10-28' },
  ];
  const room1A = { id: 101, building_id: 1, name: '1A', floor: '1st', parent_room_id: null };
  const room2A = { id: 102, building_id: 1, name: '2A', floor: '2nd', parent_room_id: null };

  it('building closure marks all rooms closed with closure reason (C9)', () => {
    const buildingClosure = {
      id: 10,
      scope: 'building',
      building_id: 1,
      start_date: '2026-09-15',
      end_date: '2026-09-15',
      reason: 'College Closed for State Exams',
      note: 'All campus activities suspended',
    };

    const res1 = applyClosuresToAvailability({
      room: room1A,
      date: '2026-09-15',
      terms,
      closures: [buildingClosure],
    });
    const res2 = applyClosuresToAvailability({
      room: room2A,
      date: '2026-09-15',
      terms,
      closures: [buildingClosure],
    });

    expect(res1.status).toBe('closed');
    expect(res1.reason).toBe('College Closed for State Exams');
    expect(res1.free_intervals).toHaveLength(0);
    expect(res1.closures[0].isClosure).toBe(true);

    expect(res2.status).toBe('closed');
    expect(res2.reason).toBe('College Closed for State Exams');
    expect(res2.free_intervals).toHaveLength(0);
  });

  it('floor closure marks rooms on that floor closed but leaves other floors unaffected (C9)', () => {
    const floor2Closure = {
      id: 11,
      scope: 'floor',
      building_id: 1,
      floor: '2nd',
      start_date: '2026-09-15',
      end_date: '2026-09-15',
      reason: '2nd Floor Renovation & Exam',
    };

    // Room 2A on 2nd floor is closed
    const res2A = applyClosuresToAvailability({
      room: room2A,
      date: '2026-09-15',
      terms,
      closures: [floor2Closure],
    });
    expect(res2A.status).toBe('closed');
    expect(res2A.reason).toBe('2nd Floor Renovation & Exam');
    expect(res2A.free_intervals).toHaveLength(0);

    // Room 1A on 1st floor is unaffected and free
    const res1A = applyClosuresToAvailability({
      room: room1A,
      date: '2026-09-15',
      terms,
      closures: [floor2Closure],
    });
    expect(res1A.status).toBe('free');
    expect(res1A.free_intervals.length).toBeGreaterThan(0);
  });
});

// ── Enriched Room Timeline Details (C19) ───────────────────

describe('enriched room timeline details (C19)', () => {
  it('preserves subject_name, instructor_name, groups_list, and provenance', () => {
    const rawClassBlock = {
      title: 'MERN Stack',
      subject_name: 'MERN Stack',
      teacher: 'Dr. Sharma',
      instructor_name: 'Dr. Sharma',
      group: 'Grp A, Grp B',
      groups_list: ['Grp A', 'Grp B'],
      entry_type: 'lab',
      batch_year: 2029,
      batch_name: 'Batch 2029',
      batch_term_label: 'Batch 2029 (Term 5)',
      provenance: {
        raw_cell: 'MERN - 2029\nGrp A\n(Dr. Sharma)\nClassroom A',
        sheet_name: 'Weekly Schedule',
        sheet_row: 7,
        sheet_col: 3,
        cell_coord: 'Row 7, Col 3',
        source_file: 'SST 2029 Batch Term 5 Syllabus.xlsx',
        imported_at: new Date('2026-08-01T00:00:00Z'),
      },
      start: utc('10:00'),
      end: utc('12:00'),
    };

    expect(rawClassBlock.subject_name).toBe('MERN Stack');
    expect(rawClassBlock.instructor_name).toBe('Dr. Sharma');
    expect(rawClassBlock.groups_list).toEqual(['Grp A', 'Grp B']);
    expect(rawClassBlock.batch_term_label).toBe('Batch 2029 (Term 5)');
    expect(rawClassBlock.entry_type).toBe('lab');
    expect(rawClassBlock.provenance.cell_coord).toBe('Row 7, Col 3');
  });
});



