import { query } from '../config/db.js';
import {
  toDateStr,
  dayOfWeekForDateStr,
  dayOfWeekInTz,
  addDaysToDateStr,
  zonedTimeToUtc,
} from '../utils/timezone.js';

const BUFFER_MINUTES = parseInt(process.env.BUFFER_MINUTES || '5', 10);

/**
 * ─── AVAILABILITY ENGINE ──────────────────────────────────────────────
 *
 * The core computation described in PRD section 5:
 * 1. Expand recurring timetable entries into concrete occurrences for a date
 * 2. Remove cancelled occurrences
 * 3. Add one-off events
 * 4. Sort and merge overlapping/touching busy blocks
 * 5. Find free intervals between busy blocks (bounded by opening/closing hours)
 * 6. For "free now", return the interval containing the current time
 *    For a window search, return rooms with a free interval covering the whole window
 *
 * All wall-clock times (timetable, opening hours) are interpreted in the campus
 * time zone and then converted to UTC instants before comparison.
 */

/**
 * Get all rooms with their availability status for a given moment.
 *
 * Returns an envelope so callers can distinguish "no free rooms" from
 * "the schedule is unknown for this date" (PRD section 5/8).
 */
export async function getFreeRoomsNow({ buildingId, now = new Date(), minDuration = 60, floor }) {
  const rooms = await getRooms(buildingId, floor);
  const building = await getBuilding(buildingId);

  if (!building) {
    return { status: 'unknown', reason: 'building_not_found', rooms: [], coverage: null };
  }

  const dateStr = toDateStr(now);
  const dayOfWeek = dayOfWeekInTz(now);
  const coverage = await getTimetableCoverage(buildingId);

  // C2: holidays no longer close rooms; removed isClosedDay check

  if (!(await hasTimetableForDate(buildingId, dateStr))) {
    return { status: 'unknown', reason: 'Outside academic term: no timetable data', rooms: [], coverage };
  }

  const results = [];

  for (const room of rooms) {
    const availability = await computeRoomAvailability(room, dateStr, dayOfWeek, building, now);

    if (availability.status === 'free') {
      const freeMinutes = (availability.free_until - now) / (1000 * 60);
      if (freeMinutes >= minDuration) {
        results.push({
          ...room,
          status: 'free',
          free_until: availability.free_until,
          free_duration: Math.floor(freeMinutes),
          busy_blocks: availability.busy_blocks,
        });
      }
    }
  }

  results.sort(
    (a, b) =>
      b.free_duration - a.free_duration ||
      String(a.building_name).localeCompare(String(b.building_name)) ||
      String(a.floor).localeCompare(String(b.floor)) ||
      String(a.name).localeCompare(String(b.name))
  );

  return { status: 'ok', rooms: results, coverage };
}

/**
 * Find rooms free for an entire future window.
 */
export async function getFreeRoomsForWindow({ buildingId, date, startTime, endTime, floor, capacity }) {
  const rooms = await getRooms(buildingId, floor, capacity);
  const building = await getBuilding(buildingId);

  if (!building) {
    return { status: 'unknown', reason: 'building_not_found', rooms: [], coverage: null };
  }

  const dayOfWeek = dayOfWeekForDateStr(date);
  const coverage = await getTimetableCoverage(buildingId);

  // C2: holidays no longer close rooms; removed isClosedDay check

  if (!(await hasTimetableForDate(buildingId, date))) {
    return { status: 'unknown', reason: 'Outside academic term: no timetable data', rooms: [], coverage };
  }

  const windowStart = zonedTimeToUtc(date, startTime);
  const windowEnd = zonedTimeToUtc(date, endTime);

  const results = [];

  for (const room of rooms) {
    const availability = await computeRoomAvailability(room, date, dayOfWeek, building);

    const isFreeForWindow = availability.free_intervals.some(
      (interval) => interval.start <= windowStart && interval.end >= windowEnd
    );

    if (isFreeForWindow) {
      results.push({
        ...room,
        status: 'free_for_window',
        busy_blocks: availability.busy_blocks,
      });
    }
  }

  return { status: 'ok', rooms: results, coverage };
}

/**
 * Get a single room's full-day availability with timeline.
 */
export async function getRoomTimeline(roomId, date) {
  const roomRes = await query(
    'SELECT r.*, b.opening_time, b.closing_time, b.name as building_name FROM rooms r JOIN buildings b ON r.building_id = b.id WHERE r.id = $1',
    [roomId]
  );
  if (roomRes.rows.length === 0) return null;

  const room = roomRes.rows[0];
  const dayOfWeek = dayOfWeekForDateStr(date);
  const building = { opening_time: room.opening_time, closing_time: room.closing_time };
  const coverage = await getTimetableCoverage(room.building_id);

  const base = {
    ...room,
    date,
    busy_blocks: [],
    free_intervals: [],
    free_until: null,
    coverage,
  };

  // C2: holidays no longer close rooms; removed isClosedDay check

  if (!(await hasTimetableForDate(room.building_id, date))) {
    return { ...base, status: 'unknown', reason: 'Outside academic term: no timetable data' };
  }

  const isToday = date === toDateStr();
  const availability = await computeRoomAvailability(
    room,
    date,
    dayOfWeek,
    building,
    isToday ? new Date() : null
  );

  return {
    ...base,
    busy_blocks: availability.busy_blocks,
    free_intervals: availability.free_intervals,
    status: availability.status === 'closed'
      ? 'closed'
      : isToday
      ? availability.status
      : 'scheduled',
    reason: availability.reason || null,
    free_until: availability.free_until,
  };
}

async function computeRoomAvailability(room, dateStr, dayOfWeek, building, now = null) {
  const childRooms = room.parent_room_id ? [] : await getChildRooms(room.id);
  const noClassDay = await getNoClassDay(room.building_id, dateStr);

  let busyBlocks = [];

  // C12: On holidays and breaks, timetable classes do NOT run
  if (!noClassDay) {
    busyBlocks = await getTimetableOccurrences(room.id, dateStr, dayOfWeek);

    if (room.parent_room_id) {
      const parentBlocks = await getTimetableOccurrences(room.parent_room_id, dateStr, dayOfWeek);
      busyBlocks = [...busyBlocks, ...parentBlocks];
    } else {
      for (const child of childRooms) {
        const childBlocks = await getTimetableOccurrences(child.id, dateStr, dayOfWeek);
        busyBlocks = [...busyBlocks, ...childBlocks];
      }
    }

    busyBlocks = await removeCancelledOccurrences(busyBlocks, dateStr);
  }

  const eventBlocks = await getEventOccurrences(room.id, dateStr);
  busyBlocks = [...busyBlocks, ...eventBlocks];

  if (room.parent_room_id) {
    const parentEvents = await getEventOccurrences(room.parent_room_id, dateStr);
    busyBlocks = [...busyBlocks, ...parentEvents];
  } else {
    for (const child of childRooms) {
      const childEvents = await getEventOccurrences(child.id, dateStr);
      busyBlocks = [...busyBlocks, ...childEvents];
    }
  }

  busyBlocks = busyBlocks.map((block) => ({
    ...block,
    start: new Date(block.start.getTime() - BUFFER_MINUTES * 60000),
    end: new Date(block.end.getTime() + BUFFER_MINUTES * 60000),
  }));

  // C7: closures rank above timetable
  const closureBlocks = await getClosureOccurrences(room, childRooms, dateStr, building);
  busyBlocks = mergeOverlapping([...busyBlocks, ...closureBlocks]);

  const dayStart = zonedTimeToUtc(dateStr, building.opening_time);
  const dayEnd = zonedTimeToUtc(dateStr, building.closing_time);
  const freeIntervals = computeFreeIntervals(busyBlocks, dayStart, dayEnd);

  let status = 'free';
  let freeUntil = null;
  let reason = null;

  const wholeDayClosure = closureBlocks.find((c) => c.start <= dayStart && c.end >= dayEnd);
  if (wholeDayClosure) {
    status = 'closed';
    reason = wholeDayClosure.reason || 'Exam';
  }

  if (now) {
    const activeClosure = closureBlocks.find((c) => c.start <= now && c.end > now);
    if (activeClosure) {
      status = 'closed';
      reason = activeClosure.reason || 'Exam';
    } else {
      const currentFree = freeIntervals.find(
        (interval) => interval.start <= now && interval.end > now
      );

      if (currentFree) {
        status = 'free';
        freeUntil = currentFree.end;
      } else {
        status = 'busy';
      }
    }
  } else if (!wholeDayClosure) {
    status = freeIntervals.length > 0 ? 'free' : 'busy';
  }

  return {
    status,
    reason,
    no_class_day: noClassDay ? { reason: noClassDay.reason } : null,
    free_until: freeUntil,
    busy_blocks: busyBlocks.map((b) => ({
      title: b.title,
      teacher: b.teacher,
      group: b.group,
      start: b.start,
      end: b.end,
      is_closure: !!b.isClosure,
      reason: b.reason || null,
    })),
    free_intervals: freeIntervals,
  };
}

/**
 * Get timetable occurrences for a room on a specific day,
 * expanded into concrete UTC Date objects for the given campus date.
 *
 * v2 (C3, C17): prefers term date range via terms.start_date/end_date;
 * falls back to legacy valid_from/valid_to for entries without a term_id.
 */
async function getTimetableOccurrences(roomId, dateStr, dayOfWeek) {
  const res = await query(
    `
    SELECT
      te.id,
      te.entry_type,
      te.start_time,
      te.end_time,
      -- v2 linked fields
      s.name          AS subject_name,
      i.name          AS instructor_name,
      -- legacy fallbacks
      te.course_name,
      te.teacher,
      te.group_name
    FROM timetable_entries te
    LEFT JOIN terms       t ON t.id = te.term_id
    LEFT JOIN subjects    s ON s.id = te.subject_id
    LEFT JOIN instructors i ON i.id = te.instructor_id
    WHERE te.room_id    = $1
      AND te.day_of_week = $2
      AND (
        -- entries with a term: active when date is inside the term
        (te.term_id IS NOT NULL AND t.start_date <= $3 AND t.end_date >= $3)
        OR
        -- legacy entries without a term: use old valid_from/valid_to
        (te.term_id IS NULL AND te.valid_from <= $3 AND te.valid_to >= $3)
      )
  `,
    [roomId, dayOfWeek, dateStr]
  );

  return res.rows.map((entry) => ({
    timetable_entry_id: entry.id,
    title: entry.subject_name || entry.course_name,
    teacher: entry.instructor_name || entry.teacher,
    group: entry.group_name,
    entry_type: entry.entry_type || 'class',
    start: zonedTimeToUtc(dateStr, entry.start_time),
    end: zonedTimeToUtc(dateStr, entry.end_time),
    type: 'class',
  }));
}

/**
 * Remove blocks whose timetable_entry_id has a cancellation for this date.
 */
async function removeCancelledOccurrences(blocks, dateStr) {
  if (blocks.length === 0) return blocks;

  const entryIds = blocks.filter((b) => b.timetable_entry_id).map((b) => b.timetable_entry_id);

  if (entryIds.length === 0) return blocks;

  const res = await query(
    `
    SELECT timetable_entry_id FROM schedule_exceptions
    WHERE timetable_entry_id = ANY($1) AND date = $2
  `,
    [entryIds, dateStr]
  );

  const cancelledIds = new Set(res.rows.map((r) => r.timetable_entry_id));

  return blocks.filter((b) => !b.timetable_entry_id || !cancelledIds.has(b.timetable_entry_id));
}

/**
 * Get one-off events for a room that overlap the given campus date.
 */
async function getEventOccurrences(roomId, dateStr) {
  const rangeStart = zonedTimeToUtc(dateStr, '00:00:00');
  const rangeEnd = zonedTimeToUtc(addDaysToDateStr(dateStr, 1), '00:00:00');

  const res = await query(
    `
    SELECT id, title, start_at, end_at
    FROM events
    WHERE room_id = $1
      AND start_at < $3
      AND end_at > $2
  `,
    [roomId, rangeStart, rangeEnd]
  );

  return res.rows.map((event) => ({
    title: event.title,
    start: new Date(event.start_at),
    end: new Date(event.end_at),
    type: 'event',
  }));
}

/**
 * Sort blocks by start time and merge overlapping/touching ones.
 */
export function mergeOverlapping(blocks) {
  if (blocks.length === 0) return [];

  const sorted = [...blocks].sort((a, b) => a.start - b.start);
  const merged = [{ ...sorted[0] }];

  for (let i = 1; i < sorted.length; i += 1) {
    const last = merged[merged.length - 1];
    const curr = sorted[i];

    if (curr.start <= last.end) {
      if (curr.end > last.end) {
        last.end = curr.end;
        last.title = `${last.title} / ${curr.title}`;
      }
    } else {
      merged.push({ ...curr });
    }
  }

  return merged;
}

/**
 * Given sorted, non-overlapping busy blocks and day bounds,
 * return the free intervals.
 */
export function computeFreeIntervals(busyBlocks, dayStart, dayEnd) {
  const free = [];
  let cursor = dayStart;

  for (const block of busyBlocks) {
    if (block.start > cursor) {
      free.push({ start: new Date(cursor), end: new Date(block.start) });
    }
    if (block.end > cursor) {
      cursor = new Date(block.end);
    }
  }

  if (cursor < dayEnd) {
    free.push({ start: new Date(cursor), end: new Date(dayEnd) });
  }

  return free;
}

/**
 * Check whether a date string falls inside any term in a list of terms (C5).
 */
export function isDateInsideAnyTerm(dateStr, terms = []) {
  if (!Array.isArray(terms) || terms.length === 0) return false;
  return terms.some((term) => {
    const s = typeof term.start_date === 'string' ? term.start_date : toDateStr(term.start_date);
    const e = typeof term.end_date === 'string' ? term.end_date : toDateStr(term.end_date);
    return s <= dateStr && e >= dateStr;
  });
}

/**
 * Pure evaluation function for availability on a date given terms and busy blocks (C5).
 * Used for unit testing the C5 engine rule without database dependencies.
 */
export function evaluateDateAvailability({
  date,
  terms = [],
  busyBlocks = [],
  dayStart = '06:00',
  dayEnd = '22:00',
  now = null,
}) {
  if (!isDateInsideAnyTerm(date, terms)) {
    return {
      status: 'unknown',
      reason: 'Outside academic term: no timetable data',
      free_until: null,
      free_intervals: [],
      busy_blocks: [],
    };
  }

  const startUtc = typeof dayStart === 'string' ? zonedTimeToUtc(date, dayStart) : dayStart;
  const endUtc = typeof dayEnd === 'string' ? zonedTimeToUtc(date, dayEnd) : dayEnd;
  const freeIntervals = computeFreeIntervals(busyBlocks, startUtc, endUtc);

  let status = 'free';
  let freeUntil = null;

  if (now) {
    const currentFree = freeIntervals.find(
      (interval) => interval.start <= now && interval.end > now
    );
    if (currentFree) {
      status = 'free';
      freeUntil = currentFree.end;
    } else {
      status = 'busy';
    }
  } else {
    status = freeIntervals.length > 0 ? 'free' : 'busy';
  }

  return {
    status,
    free_until: freeUntil,
    free_intervals: freeIntervals,
    busy_blocks: busyBlocks,
  };
}

/**
 * Test whether a closure applies to a specific room, taking into account
 * building, floor, room, and 2B parent/child relationships (C7).
 */
export function doesClosureApplyToRoom(closure, room, childRoomIds = [], parentRoomId = null) {
  if (closure.scope === 'building') {
    if (closure.building_id && room.building_id && closure.building_id !== room.building_id) {
      return false;
    }
    return true;
  }
  if (closure.scope === 'floor') {
    return String(closure.floor || '').toLowerCase().trim() === String(room.floor || '').toLowerCase().trim();
  }
  if (closure.scope === 'room') {
    if (closure.room_id === room.id) return true;
    const parent = parentRoomId !== null ? parentRoomId : room.parent_room_id;
    if (parent && closure.room_id === parent) return true;
    const children = childRoomIds.length > 0 ? childRoomIds : (room.childRoomIds || []);
    if (Array.isArray(children) && children.includes(closure.room_id)) return true;
    return false;
  }
  return false;
}

/**
 * Convert a closure into a busy block on a date (C7).
 */
export function closureToBusyBlock(closure, dateStr, openingTime = '06:00', closingTime = '22:00') {
  const isWholeDay = !closure.start_time || !closure.end_time;
  const startStr = isWholeDay ? openingTime : String(closure.start_time).slice(0, 5);
  const endStr = isWholeDay ? closingTime : String(closure.end_time).slice(0, 5);
  return {
    title: closure.reason || 'Exam',
    reason: closure.reason || 'Exam',
    note: closure.note || null,
    isClosure: true,
    isWholeDay,
    scope: closure.scope,
    start: zonedTimeToUtc(dateStr, startStr),
    end: zonedTimeToUtc(dateStr, endStr),
  };
}

/**
 * Pure evaluation function for room availability applying terms, timetable, and closures (C7).
 */
export function applyClosuresToAvailability({
  room,
  date,
  terms = [],
  timetableBlocks = [],
  closures = [],
  noClassDay = false,
  childRoomIds = [],
  parentRoomId = null,
  openingTime = '06:00',
  closingTime = '22:00',
  now = null,
}) {
  if (!isDateInsideAnyTerm(date, terms)) {
    return {
      status: 'unknown',
      reason: 'Outside academic term: no timetable data',
      free_until: null,
      free_intervals: [],
      busy_blocks: [],
      closures: [],
    };
  }

  // C12: On no-class days, timetable classes do NOT run
  const effectiveTimetable = noClassDay ? [] : timetableBlocks;

  const pRoomId = parentRoomId !== null ? parentRoomId : room.parent_room_id;
  const cRoomIds = childRoomIds.length > 0 ? childRoomIds : (room.childRoomIds || []);

  const relevantClosures = closures.filter((c) =>
    doesClosureApplyToRoom(c, room, cRoomIds, pRoomId)
  );

  const closureBlocks = relevantClosures.map((c) =>
    closureToBusyBlock(c, date, openingTime, closingTime)
  );

  const dayStart = zonedTimeToUtc(date, openingTime);
  const dayEnd = zonedTimeToUtc(date, closingTime);

  const allBlocks = mergeOverlapping([...effectiveTimetable, ...closureBlocks]);
  const freeIntervals = computeFreeIntervals(allBlocks, dayStart, dayEnd);

  let status = 'free';
  let freeUntil = null;
  let reason = null;

  const wholeDayClosure = closureBlocks.find((c) => c.start <= dayStart && c.end >= dayEnd);
  if (wholeDayClosure) {
    status = 'closed';
    reason = wholeDayClosure.reason || 'Exam';
  }

  if (now) {
    const activeClosure = closureBlocks.find((c) => c.start <= now && c.end > now);
    if (activeClosure) {
      status = 'closed';
      reason = activeClosure.reason || 'Exam';
    } else {
      const currentFree = freeIntervals.find((interval) => interval.start <= now && interval.end > now);
      if (currentFree) {
        status = 'free';
        freeUntil = currentFree.end;
      } else {
        status = 'busy';
      }
    }
  } else if (!wholeDayClosure) {
    status = freeIntervals.length > 0 ? 'free' : 'busy';
  }

  return {
    status,
    reason,
    no_class_day: noClassDay ? (typeof noClassDay === 'object' ? noClassDay : { reason: 'Holiday' }) : null,
    free_until: freeUntil,
    free_intervals: freeIntervals,
    busy_blocks: allBlocks,
    closures: closureBlocks,
  };
}

/**
 * Fetch closures applying to a room from the database (C7).
 */
async function getClosureOccurrences(room, childRooms, dateStr, building) {
  const roomIds = [room.id];
  if (room.parent_room_id) roomIds.push(room.parent_room_id);
  if (Array.isArray(childRooms)) {
    for (const child of childRooms) {
      roomIds.push(child.id);
    }
  }

  const res = await query(
    `SELECT *
     FROM closures
     WHERE start_date <= $1 AND end_date >= $1
       AND (
         (scope = 'building' AND (building_id IS NULL OR building_id = $2))
         OR
         (scope = 'floor' AND LOWER(TRIM(floor)) = LOWER(TRIM($3)))
         OR
         (scope = 'room' AND room_id = ANY($4::int[]))
       )
     ORDER BY id ASC`,
    [dateStr, room.building_id, room.floor, roomIds]
  );

  return res.rows.map((c) =>
    closureToBusyBlock(c, dateStr, building.opening_time, building.closing_time)
  );
}

/**
 * Fetch whether the given date is marked as a no-class day (C12).
 */
export async function getNoClassDay(buildingId, dateStr) {
  const res = await query(
    `SELECT * FROM no_class_days
     WHERE (building_id IS NULL OR building_id = $1) AND date = $2
     LIMIT 1`,
    [buildingId, dateStr]
  );
  return res.rows[0] || null;
}

/**
 * Whether the given date falls inside any term for rooms in this building,
 * OR inside any legacy timetable entry's valid_from/valid_to range (C5).
 * When a query date does NOT fall within ANY term (SELECT id FROM terms WHERE start_date <= date AND end_date >= date):
 * do NOT assume rooms are free. Return status = "unknown" (reason = "Outside academic term: no timetable data").
 */
export async function hasTimetableForDate(buildingId, dateStr, terms = null) {
  if (Array.isArray(terms)) {
    return isDateInsideAnyTerm(dateStr, terms);
  }

  // Check if date falls within ANY term (C5)
  const termRes = await query(
    `SELECT id FROM terms WHERE start_date <= $1 AND end_date >= $1 LIMIT 1`,
    [dateStr]
  );
  if (termRes.rows.length > 0) return true;

  // Fallback for legacy timetable entries with valid_from/valid_to
  const legacyRes = await query(
    `SELECT te.id
     FROM timetable_entries te
     JOIN rooms r ON r.id = te.room_id
     WHERE r.building_id = $1
       AND te.term_id IS NULL
       AND te.valid_from <= $2
       AND te.valid_to >= $2
     LIMIT 1`,
    [buildingId, dateStr]
  );
  return legacyRes.rows.length > 0;
}

// ── Helper queries ─────────────────────────────────────────

async function getRooms(buildingId, floor = null, capacity = null) {
  let sql = `
    SELECT r.*, b.name as building_name
    FROM rooms r
    JOIN buildings b ON r.building_id = b.id
    WHERE r.building_id = $1
  `;
  const params = [buildingId];

  if (floor) {
    params.push(floor);
    sql += ` AND r.floor = $${params.length}`;
  }
  if (capacity) {
    params.push(capacity);
    sql += ` AND r.capacity >= $${params.length}`;
  }

  sql += ' ORDER BY r.floor, r.name';
  const res = await query(sql, params);
  return res.rows;
}

async function getBuilding(buildingId) {
  const res = await query('SELECT * FROM buildings WHERE id = $1', [buildingId]);
  return res.rows[0];
}

async function getChildRooms(roomId) {
  const res = await query('SELECT id FROM rooms WHERE parent_room_id = $1', [roomId]);
  return res.rows;
}

/**
 * Return the date coverage for the building.
 * v2: uses terms table (C3); falls back to legacy valid_from/valid_to.
 */
async function getTimetableCoverage(buildingId) {
  // Coverage from terms
  const termRes = await query(
    `
    SELECT MIN(t.start_date)::text AS valid_from, MAX(t.end_date)::text AS valid_to
    FROM terms t
    JOIN batches b ON b.id = t.batch_id
    JOIN timetable_entries te ON te.term_id = t.id
    JOIN rooms r ON r.id = te.room_id
    WHERE r.building_id = $1
  `,
    [buildingId]
  );
  const termRow = termRes.rows[0];
  if (termRow && termRow.valid_from) {
    return { valid_from: termRow.valid_from, valid_to: termRow.valid_to };
  }

  // Fallback: legacy valid_from/valid_to
  const legacyRes = await query(
    `
    SELECT MIN(te.valid_from)::text AS valid_from, MAX(te.valid_to)::text AS valid_to
    FROM timetable_entries te
    JOIN rooms r ON r.id = te.room_id
    WHERE r.building_id = $1 AND te.term_id IS NULL
  `,
    [buildingId]
  );
  const legacyRow = legacyRes.rows[0];
  if (!legacyRow || !legacyRow.valid_from) return null;
  return { valid_from: legacyRow.valid_from, valid_to: legacyRow.valid_to };
}

// C2: isClosedDay removed — holidays and breaks no longer close rooms.
// The closed_days table remains in the schema; C6 will replace it with closures.
