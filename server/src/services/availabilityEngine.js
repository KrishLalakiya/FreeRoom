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

  if (await isClosedDay(buildingId, dateStr)) {
    return { status: 'closed', reason: 'closed_day', rooms: [], coverage };
  }

  if (!(await hasTimetableForDate(buildingId, dateStr))) {
    return { status: 'unknown', reason: 'outside_timetable_coverage', rooms: [], coverage };
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

  if (await isClosedDay(buildingId, date)) {
    return { status: 'closed', reason: 'closed_day', rooms: [], coverage };
  }

  if (!(await hasTimetableForDate(buildingId, date))) {
    return { status: 'unknown', reason: 'outside_timetable_coverage', rooms: [], coverage };
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

  if (await isClosedDay(room.building_id, date)) {
    return { ...base, status: 'closed' };
  }

  if (!(await hasTimetableForDate(room.building_id, date))) {
    return { ...base, status: 'unknown' };
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
    status: isToday ? availability.status : 'scheduled',
    free_until: availability.free_until,
  };
}

/**
 * Core availability computation for a single room on a given date.
 */
async function computeRoomAvailability(room, dateStr, dayOfWeek, building, now = null) {
  let busyBlocks = await getTimetableOccurrences(room.id, dateStr, dayOfWeek);
  const childRooms = room.parent_room_id ? [] : await getChildRooms(room.id);

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

  busyBlocks = mergeOverlapping(busyBlocks);

  const dayStart = zonedTimeToUtc(dateStr, building.opening_time);
  const dayEnd = zonedTimeToUtc(dateStr, building.closing_time);
  const freeIntervals = computeFreeIntervals(busyBlocks, dayStart, dayEnd);

  let status = 'unknown';
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
  }

  return {
    status,
    free_until: freeUntil,
    busy_blocks: busyBlocks.map((b) => ({
      title: b.title,
      teacher: b.teacher,
      group: b.group,
      start: b.start,
      end: b.end,
    })),
    free_intervals: freeIntervals,
  };
}

/**
 * Get timetable occurrences for a room on a specific day,
 * expanded into concrete UTC Date objects for the given campus date.
 */
async function getTimetableOccurrences(roomId, dateStr, dayOfWeek) {
  const res = await query(
    `
    SELECT id, course_name, teacher, group_name, start_time, end_time
    FROM timetable_entries
    WHERE room_id = $1
      AND day_of_week = $2
      AND valid_from <= $3
      AND valid_to >= $3
  `,
    [roomId, dayOfWeek, dateStr]
  );

  return res.rows.map((entry) => ({
    timetable_entry_id: entry.id,
    title: entry.course_name,
    teacher: entry.teacher,
    group: entry.group_name,
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
 * Whether any timetable entry is valid on this campus date.
 * A date with no timetable coverage is "unknown", never "free" (PRD section 5).
 */
async function hasTimetableForDate(buildingId, dateStr) {
  const res = await query(
    `
    SELECT 1 FROM timetable_entries te
    JOIN rooms r ON r.id = te.room_id
    WHERE r.building_id = $1
      AND te.valid_from <= $2
      AND te.valid_to >= $2
    LIMIT 1
  `,
    [buildingId, dateStr]
  );
  return res.rows.length > 0;
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

async function getTimetableCoverage(buildingId) {
  const res = await query(
    `
    SELECT MIN(te.valid_from)::text AS valid_from, MAX(te.valid_to)::text AS valid_to
    FROM timetable_entries te
    JOIN rooms r ON r.id = te.room_id
    WHERE r.building_id = $1
  `,
    [buildingId]
  );
  const row = res.rows[0];
  if (!row || !row.valid_from) return null;
  return { valid_from: row.valid_from, valid_to: row.valid_to };
}

async function isClosedDay(buildingId, dateStr) {
  const res = await query('SELECT 1 FROM closed_days WHERE building_id = $1 AND date = $2', [
    buildingId,
    dateStr,
  ]);
  return res.rows.length > 0;
}
