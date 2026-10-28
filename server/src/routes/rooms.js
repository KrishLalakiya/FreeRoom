import { Router } from 'express';
import { query } from '../config/db.js';
import {
  getFreeRoomsNow,
  getFreeRoomsForWindow,
  getRoomTimeline,
  getNextDayTimetableData,
  apply2BRule,
  getAllRoomsAvailabilityForDate,
  availabilityCache,
} from '../services/availabilityEngine.js';
import { calculateGapPlan } from '../services/roomChainingEngine.js';
import { getSystemSettings } from '../services/systemSettings.js';
import { optionalAuthenticate } from '../middleware/auth.js';
import { toDateStr, isValidDateStr, dayOfWeekForDateStr, parseMockOrNow } from '../utils/timezone.js';

const router = Router();

/**
 * GET /api/rooms/free-now
 * Get rooms that are free right now.
 * Query params: buildingId, minDuration (minutes), floor
 */
router.get('/free-now', optionalAuthenticate, async (req, res) => {
  try {
    const buildingId = parseInt(req.query.buildingId || '1', 10);
    let minDuration = parseInt(req.query.minDuration || '60', 10);
    const floor = req.query.floor || null;

    if (!Number.isInteger(buildingId) || buildingId < 1) {
      return res.status(400).json({
        error: 'Invalid building',
        message: 'buildingId must be a positive integer.',
      });
    }

    if (isNaN(minDuration) || minDuration < 1) {
      minDuration = 1;
    } else if (minDuration > 720) {
      minDuration = 720;
    }

    const mockTime = req.query.now || req.headers['x-mock-time'];
    const now = parseMockOrNow(mockTime);
    const bypassCache = !!mockTime;
    const result = await getFreeRoomsNow({ buildingId, now, minDuration, floor, bypassCache });

    // Room SSB is class-only for all batches; no open seating / free study allowed
    result.rooms = (result.rooms || []).filter((r) => (r.name || '').toUpperCase() !== 'SSB');
    if (result.closed_rooms) {
      result.closed_rooms = result.closed_rooms.filter((r) => (r.name || '').toUpperCase() !== 'SSB');
    }
    if (result.next_day?.rooms) {
      result.next_day.rooms = result.next_day.rooms.filter((r) => (r.name || '').toUpperCase() !== 'SSB');
    }

    res.json({
      query: { buildingId, minDuration, floor, timestamp: now.toISOString() },
      status: result.status,
      reason: result.reason,
      note: result.note || null,
      building_closure: result.building_closure || null,
      coverage: result.coverage,
      count: result.rooms.length,
      rooms: result.rooms,
      closed_rooms: result.closed_rooms || [],
      is_after_last_class: !!result.is_after_last_class,
      next_day: result.next_day || null,
    });
  } catch (err) {
    console.error('Free-now error:', err);
    res.status(500).json({ error: 'Failed to fetch free rooms' });
  }
});

/**
 * GET /api/rooms/next-timetable
 * Get full timetable and morning room availability for a specific day.
 */
router.get('/next-timetable', optionalAuthenticate, async (req, res) => {
  try {
    const buildingId = parseInt(req.query.buildingId || '1', 10);
    let date = req.query.date;
    if (!date || !isValidDateStr(date)) {
      date = toDateStr();
    }

    const buildingRes = await query('SELECT * FROM buildings WHERE id = $1', [buildingId]);
    if (buildingRes.rows.length === 0) {
      return res.status(404).json({ error: 'Building not found' });
    }
    const building = buildingRes.rows[0];

    const roomsRes = await query('SELECT * FROM rooms WHERE building_id = $1 ORDER BY id', [buildingId]);
    const rooms = roomsRes.rows;

    const dow = dayOfWeekForDateStr(date);
    const data = await getNextDayTimetableData(buildingId, date, dow, building, rooms);
    if (data?.rooms) {
      data.rooms = data.rooms.filter((r) => (r.name || '').toUpperCase() !== 'SSB');
    }
    res.json(data);
  } catch (err) {
    console.error('Next-timetable error:', err);
    res.status(500).json({ error: 'Failed to fetch timetable' });
  }
});

/**
 * GET /api/rooms/free-window
 * Get rooms free for a specific future window.
 * Query params: buildingId, date, startTime, endTime, floor, capacity
 */
router.get('/free-window', optionalAuthenticate, async (req, res) => {
  try {
    const { date, startTime, endTime } = req.query;
    const buildingId = parseInt(req.query.buildingId || '1', 10);
    const floor = req.query.floor || null;
    const capacity = req.query.capacity ? parseInt(req.query.capacity, 10) : null;

    // Validate required params
    if (!date || !startTime || !endTime) {
      return res.status(400).json({
        error: 'Missing parameters',
        message: 'date, startTime, and endTime are required.',
      });
    }

    if (!isValidDateStr(date)) {
      return res.status(400).json({
        error: 'Invalid date',
        message: 'date must be a real calendar date in YYYY-MM-DD format.',
      });
    }

    if (!/^\d{2}:\d{2}(:\d{2})?$/.test(startTime) || !/^\d{2}:\d{2}(:\d{2})?$/.test(endTime)) {
      return res.status(400).json({
        error: 'Invalid time',
        message: 'startTime and endTime must be in HH:MM format.',
      });
    }

    if (date < toDateStr()) {
      return res.status(400).json({
        error: 'Invalid date',
        message: 'The search window cannot be in the past.',
      });
    }

    // Validate window
    if (startTime >= endTime) {
      return res.status(400).json({
        error: 'Invalid time window',
        message: 'Start time must be before end time.',
      });
    }

    if (!Number.isInteger(buildingId) || buildingId < 1) {
      return res.status(400).json({
        error: 'Invalid building',
        message: 'buildingId must be a positive integer.',
      });
    }

    if (capacity !== null && (!Number.isInteger(capacity) || capacity < 0)) {
      return res.status(400).json({
        error: 'Invalid capacity',
        message: 'capacity must be a non-negative integer.',
      });
    }

    const result = await getFreeRoomsForWindow({ buildingId, date, startTime, endTime, floor, capacity });

    // Room SSB is class-only for all batches; no open seating / free study allowed
    result.rooms = (result.rooms || []).filter((r) => (r.name || '').toUpperCase() !== 'SSB');
    if (result.closed_rooms) {
      result.closed_rooms = result.closed_rooms.filter((r) => (r.name || '').toUpperCase() !== 'SSB');
    }

    res.json({
      query: { buildingId, date, startTime, endTime, floor, capacity },
      status: result.status,
      reason: result.reason,
      note: result.note || null,
      building_closure: result.building_closure || null,
      coverage: result.coverage,
      count: result.rooms.length,
      rooms: result.rooms,
      closed_rooms: result.closed_rooms || [],
    });
  } catch (err) {
    console.error('Free-window error:', err);
    res.status(500).json({ error: 'Failed to search rooms' });
  }
});

/**
 * GET /api/rooms/:id/timeline
 * Get a room's full-day timeline.
 * Query params: date (defaults to today)
 */
router.get('/:id/timeline', optionalAuthenticate, async (req, res) => {
  try {
    let roomId = /^\d+$/.test(req.params.id) ? parseInt(req.params.id, 10) : null;
    const date = req.query.date || toDateStr();

    if (!roomId) {
      const roomLookup = await query('SELECT id, name FROM rooms WHERE UPPER(name) = UPPER($1)', [req.params.id]);
      if (roomLookup.rows.length > 0) {
        roomId = roomLookup.rows[0].id;
      } else {
        return res.status(404).json({
          error: 'Room not found',
          message: `No room named '${req.params.id}' exists.`,
        });
      }
    }

    if (!isValidDateStr(date)) {
      return res.status(400).json({
        error: 'Invalid date',
        message: 'date must be a real calendar date in YYYY-MM-DD format.',
      });
    }

    const timeline = await getRoomTimeline(roomId, date);

    if (!timeline) {
      return res.status(404).json({
        error: 'Room not found',
        message: `No room with id ${roomId} exists.`,
      });
    }

    res.json(timeline);
  } catch (err) {
    console.error('Timeline error:', err);
    res.status(500).json({ error: 'Failed to fetch room timeline' });
  }
});

/**
 * GET /api/rooms
 * List all rooms in a building.
 */
router.get('/', optionalAuthenticate, async (req, res) => {
  try {
    const buildingId = parseInt(req.query.buildingId || '1', 10);

    const result = await query(`
      SELECT r.*, b.name as building_name
      FROM rooms r
      JOIN buildings b ON r.building_id = b.id
      WHERE r.building_id = $1
      ORDER BY r.floor, r.name
    `, [buildingId]);

    res.json({ rooms: result.rows });
  } catch (err) {
    console.error('Rooms list error:', err);
    res.status(500).json({ error: 'Failed to fetch rooms' });
  }
});

/**
 * GET /api/rooms/buildings
 * List all buildings.
 */
router.get('/buildings', optionalAuthenticate, async (req, res) => {
  try {
    const result = await query('SELECT * FROM buildings ORDER BY name');
    res.json({ buildings: result.rows });
  } catch (err) {
    console.error('Buildings error:', err);
    res.status(500).json({ error: 'Failed to fetch buildings' });
  }
});

/**
 * GET /api/rooms/batches-and-groups
 * List batches and their available groups for student selection (C20).
 */
router.get('/batches-and-groups', optionalAuthenticate, async (req, res) => {
  try {
    const targetDate = req.query.date && isValidDateStr(req.query.date) ? req.query.date : toDateStr();
    const cacheKey = `batches_and_groups:${targetDate}`;
    const cached = availabilityCache.get(cacheKey);
    if (cached) {
      return res.json(structuredClone(cached));
    }
    const batchesRes = await query('SELECT id, year FROM batches ORDER BY year DESC');
    const groupsRes = await query('SELECT id, batch_id, name FROM groups ORDER BY name ASC');

    const termsRes = await query(`
      SELECT t.id, t.batch_id, t.term_number, t.semester_number, t.start_date, t.end_date
      FROM terms t
      ORDER BY t.start_date DESC, t.term_number DESC
    `);
    const targetDate = req.query.date && isValidDateStr(req.query.date) ? req.query.date : toDateStr();

    const result = batchesRes.rows.map((b) => {
      const bTerms = termsRes.rows.filter((t) => t.batch_id === b.id);
      const activeTerm = bTerms.find((t) => {
        const s = toDateStr(t.start_date);
        const e = toDateStr(t.end_date);
        return s <= targetDate && e >= targetDate;
      }) || bTerms[0];

      return {
        batchYear: b.year,
        groups: groupsRes.rows.filter((g) => g.batch_id === b.id).map((g) => g.name),
        currentTerm: activeTerm ? activeTerm.term_number : null,
        semesterNumber: activeTerm ? activeTerm.semester_number : null,
      };
    });

    const responsePayload = { batches: result };
    availabilityCache.set(cacheKey, responsePayload, 300000);
    res.json(responsePayload);
  } catch (err) {
    console.error('Batches and groups error:', err);
    res.status(500).json({ error: 'Failed to fetch batches and groups' });
  }
});

/**
 * GET /api/rooms/my-group
 * My group view: a student picks batch and group, sees that group's classes and gaps,
 * and which rooms are free during the gaps (C20).
 */
router.get('/my-group', optionalAuthenticate, async (req, res) => {
  try {
    const batchYear = parseInt(req.query.batchYear || '2029', 10);
    const groupName = (req.query.group || 'Group A').trim();
    const date = req.query.date || toDateStr();
    const buildingId = parseInt(req.query.buildingId || '1', 10);

    if (!isValidDateStr(date)) {
      return res.status(400).json({ error: 'Invalid date format' });
    }

    const cacheKey = `my_group:${buildingId}:${batchYear}:${groupName}:${date}`;
    const cached = availabilityCache.get(cacheKey);
    if (cached) {
      return res.json(structuredClone(cached));
    }

    // 1. Find term covering this date for the given batch
    const termRes = await query(`
      SELECT t.*, b.year as batch_year
      FROM terms t
      JOIN batches b ON b.id = t.batch_id
      WHERE b.year = $1
        AND t.start_date <= $2
        AND t.end_date >= $2
      LIMIT 1
    `, [batchYear, date]);

    if (termRes.rows.length === 0) {
      return res.json({
        status: 'unknown',
        reason: `No active term covering ${date} for Batch ${batchYear}.`,
        batchYear,
        group: groupName,
        date,
        classes: [],
        gaps: [],
      });
    }

    const term = termRes.rows[0];
    const dayOfWeek = dayOfWeekForDateStr(date);

    // 2. Check no-class day
    const noClassRes = await query(
      'SELECT * FROM no_class_days WHERE building_id = $1 AND date = $2',
      [buildingId, date]
    );
    const isNoClassDay = noClassRes.rows.length > 0;

    if (isNoClassDay) {
      return res.json({
        status: 'ok',
        is_no_class_day: true,
        no_class_reason: noClassRes.rows[0].reason || 'Holiday / Break',
        batchYear,
        group: groupName,
        term: { id: term.id, termNumber: term.term_number, semesterNumber: term.semester_number },
        date,
        classes: [],
        gaps: [],
      });
    }

    // 3. Fetch timetable entries for this term and day of week
    const entriesRes = await query(`
      SELECT te.id, te.room_id, r.name as room_name, r.floor, r.capacity,
             te.start_time, te.end_time, te.entry_type,
             s.name as subject_name, s.short_code as subject_code,
             i.name as instructor_name,
             ARRAY_AGG(g.name) FILTER (WHERE g.name IS NOT NULL) as groups_list
      FROM timetable_entries te
      JOIN rooms r ON r.id = te.room_id
      LEFT JOIN subjects s ON te.subject_id = s.id
      LEFT JOIN instructors i ON te.instructor_id = i.id
      LEFT JOIN timetable_entry_groups teg ON teg.timetable_entry_id = te.id
      LEFT JOIN groups g ON teg.group_id = g.id
      WHERE te.term_id = $1
        AND te.day_of_week = $2
        AND te.valid_from <= $3
        AND te.valid_to >= $3
      GROUP BY te.id, r.name, r.floor, r.capacity, s.name, s.short_code, i.name
      ORDER BY te.start_time ASC
    `, [term.id, dayOfWeek, date]);

    // 4. Filter for group (stripping leading 'Group ' so 'Group A' matches 'A')
    const targetGroupLetter = groupName.replace(/^Group\s*/i, '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();

    const groupClasses = entriesRes.rows.filter((entry) => {
      const groups = entry.groups_list || [];
      if (groups.length === 0) return true; // Whole-batch class

      return groups.some((g) => {
        const norm = g.replace(/^Group\s*/i, '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
        return norm === targetGroupLetter || norm.includes(targetGroupLetter);
      });
    });

    // Check for cancelled exceptions
    const exRes = await query(
      'SELECT timetable_entry_id FROM schedule_exceptions WHERE date = $1',
      [date]
    );
    const cancelledSet = new Set(exRes.rows.map((r) => r.timetable_entry_id));

    const activeClasses = groupClasses.filter((c) => !cancelledSet.has(c.id)).map((c) => ({
      id: c.id,
      room_name: c.room_name,
      floor: c.floor,
      capacity: c.capacity,
      start_time: String(c.start_time).slice(0, 5),
      end_time: String(c.end_time).slice(0, 5),
      entry_type: c.entry_type || 'lecture',
      subject: c.subject_name || 'Academic Class',
      subject_code: c.subject_code,
      instructor: c.instructor_name,
      groups: c.groups_list || [],
    }));

    // 5. Compute gaps between classes and after the last class (PRD v8)
    const gaps = [];
    const settings = await getSystemSettings();
    const allRoomsAvailability = await getAllRoomsAvailabilityForDate(buildingId, date);

    const gapWindows = [];
    for (let i = 0; i < activeClasses.length - 1; i++) {
      const currentEnd = activeClasses[i].end_time;
      const nextStart = activeClasses[i + 1].start_time;
      if (currentEnd < nextStart) {
        gapWindows.push({
          start: currentEnd,
          end: nextStart,
          currentRoom: activeClasses[i].room_name,
          nextClassRoom: activeClasses[i + 1].room_name,
          isAfterLastClass: false,
        });
      }
    }

    if (activeClasses.length > 0) {
      const lastClass = activeClasses[activeClasses.length - 1];
      const closingTime = '22:00';
      if (lastClass.end_time < closingTime) {
        gapWindows.push({
          start: lastClass.end_time,
          end: closingTime,
          currentRoom: lastClass.room_name,
          nextClassRoom: null,
          isAfterLastClass: true,
        });
      }
    }

    for (const gw of gapWindows) {
      const [cEndH, cEndM] = gw.start.split(':').map(Number);
      const [nStartH, nStartM] = gw.end.split(':').map(Number);
      const durationMinutes = (nStartH * 60 + nStartM) - (cEndH * 60 + cEndM);

      if (durationMinutes >= (settings.chain_min_free_minutes || 15)) {
        const freeRes = await getFreeRoomsForWindow({
          buildingId,
          date,
          startTime: gw.start,
          endTime: gw.end,
        });

        // Room SSB is class-only; no seating during break gaps for any batch
        const filteredFreeRooms = (freeRes.rooms || []).filter(
          (r) => (r.name || '').toUpperCase() !== 'SSB'
        );
        const filteredClosedRooms = (freeRes.closed_rooms || []).filter(
          (r) => (r.name || '').toUpperCase() !== 'SSB'
        );

        // PRD v8: Calculate optimal room chaining plan
        const plan = calculateGapPlan({
          gapStart: gw.start,
          gapEnd: gw.end,
          currentRoom: gw.currentRoom,
          nextClassRoom: gw.nextClassRoom,
          rooms: allRoomsAvailability,
          options: {
            minFreeMinutes: settings.chain_min_free_minutes,
            bufferMinutes: settings.buffer_minutes,
            chainEnabled: settings.chain_enabled,
            buildingClosingMinutes: 1320,
          },
        });

        gaps.push({
          start: gw.start,
          end: gw.end,
          duration_minutes: durationMinutes,
          current_room: gw.currentRoom,
          next_class_room: gw.nextClassRoom,
          is_after_last_class: gw.isAfterLastClass,
          plan,
          free_rooms_count: filteredFreeRooms.length,
          free_rooms: filteredFreeRooms.map((r) => ({
            id: r.id,
            name: r.name,
            floor: r.floor,
            capacity: r.capacity,
          })),
          closed_rooms: filteredClosedRooms.map((r) => ({
            id: r.id,
            name: r.name,
            floor: r.floor,
            closure_badge: r.closure_badge,
          })),
        });
      }
    }

    const responsePayload = {
      status: 'ok',
      date,
      day_of_week: dayOfWeek,
      batchYear,
      group: groupName,
      term: {
        id: term.id,
        term_number: term.term_number,
        semester_number: term.semester_number,
        start_date: term.start_date,
        end_date: term.end_date,
      },
      classes_count: activeClasses.length,
      classes: activeClasses,
      gaps_count: gaps.length,
      gaps,
    };
    availabilityCache.set(cacheKey, responsePayload);
    res.json(responsePayload);
  } catch (err) {
    console.error('My group error:', err);
    res.status(500).json({ error: 'Failed to fetch my group schedule' });
  }
});

export default router;
