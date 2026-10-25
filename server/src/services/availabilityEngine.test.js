import { describe, it, expect } from 'vitest';
import {
  mergeOverlapping,
  computeFreeIntervals,
  isDateInsideAnyTerm,
  evaluateDateAvailability,
  doesClosureApplyToRoom,
  closureToBusyBlock,
  applyClosuresToAvailability,
} from './availabilityEngine.js';

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


