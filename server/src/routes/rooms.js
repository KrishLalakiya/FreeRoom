import { Router } from 'express';
import { query } from '../config/db.js';
import { getFreeRoomsNow, getFreeRoomsForWindow, getRoomTimeline } from '../services/availabilityEngine.js';
import { authenticate } from '../middleware/auth.js';
import { toDateStr, isValidDateStr, dayOfWeekForDateStr } from '../utils/timezone.js';

const router = Router();

/**
 * GET /api/rooms/free-now
 * Get rooms that are free right now.
 * Query params: buildingId, minDuration (minutes), floor
 */
router.get('/free-now', authenticate, async (req, res) => {
  try {
    const buildingId = parseInt(req.query.buildingId || '1', 10);
    const minDuration = parseInt(req.query.minDuration || '60', 10);
    const floor = req.query.floor || null;

    if (!Number.isInteger(buildingId) || buildingId < 1) {
      return res.status(400).json({
        error: 'Invalid building',
        message: 'buildingId must be a positive integer.',
      });
    }

    if (minDuration < 1 || minDuration > 720) {
      return res.status(400).json({
        error: 'Invalid duration',
        message: 'Duration must be between 1 and 720 minutes.',
      });
    }

    const now = new Date();
    const result = await getFreeRoomsNow({ buildingId, now, minDuration, floor });

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
    });
  } catch (err) {
    console.error('Free-now error:', err);
    res.status(500).json({ error: 'Failed to fetch free rooms' });
  }
});

/**
 * GET /api/rooms/free-window
 * Get rooms free for a specific future window.
 * Query params: buildingId, date, startTime, endTime, floor, capacity
 */
router.get('/free-window', authenticate, async (req, res) => {
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
router.get('/:id/timeline', authenticate, async (req, res) => {
  try {
    const roomId = parseInt(req.params.id, 10);
    const date = req.query.date || toDateStr();

    if (!Number.isInteger(roomId) || roomId < 1) {
      return res.status(400).json({
        error: 'Invalid room id',
        message: 'Room id must be a positive integer.',
      });
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
router.get('/', authenticate, async (req, res) => {
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
router.get('/buildings', authenticate, async (req, res) => {
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
router.get('/batches-and-groups', authenticate, async (req, res) => {
  try {
    const batchesRes = await query('SELECT id, year FROM batches ORDER BY year DESC');
    const groupsRes = await query('SELECT id, batch_id, name FROM groups ORDER BY name ASC');

    const result = batchesRes.rows.map((b) => ({
      batchYear: b.year,
      groups: groupsRes.rows.filter((g) => g.batch_id === b.id).map((g) => g.name),
    }));

    res.json({ batches: result });
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
router.get('/my-group', authenticate, async (req, res) => {
  try {
    const batchYear = parseInt(req.query.batchYear || '2029', 10);
    const groupName = (req.query.group || 'Group A').trim();
    const date = req.query.date || toDateStr();
    const buildingId = parseInt(req.query.buildingId || '1', 10);

    if (!isValidDateStr(date)) {
      return res.status(400).json({ error: 'Invalid date format' });
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

    // 4. Filter for group
    const targetGroupLetter = groupName.replace(/[^A-Za-z0-9]/g, '').toUpperCase();

    const groupClasses = entriesRes.rows.filter((entry) => {
      const groups = entry.groups_list || [];
      if (groups.length === 0) return true; // Whole-batch class

      return groups.some((g) => {
        const norm = g.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
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

    // 5. Compute gaps between classes
    const gaps = [];
    for (let i = 0; i < activeClasses.length - 1; i++) {
      const currentEnd = activeClasses[i].end_time;
      const nextStart = activeClasses[i + 1].start_time;

      if (currentEnd < nextStart) {
        const [cEndH, cEndM] = currentEnd.split(':').map(Number);
        const [nStartH, nStartM] = nextStart.split(':').map(Number);
        const durationMinutes = (nStartH * 60 + nStartM) - (cEndH * 60 + cEndM);

        if (durationMinutes >= 15) {
          const freeRes = await getFreeRoomsForWindow({
            buildingId,
            date,
            startTime: currentEnd,
            endTime: nextStart,
          });

          gaps.push({
            start: currentEnd,
            end: nextStart,
            duration_minutes: durationMinutes,
            free_rooms_count: freeRes.rooms?.length || 0,
            free_rooms: (freeRes.rooms || []).map((r) => ({
              id: r.id,
              name: r.name,
              floor: r.floor,
              capacity: r.capacity,
            })),
            closed_rooms: (freeRes.closed_rooms || []).map((r) => ({
              id: r.id,
              name: r.name,
              floor: r.floor,
              closure_badge: r.closure_badge,
            })),
          });
        }
      }
    }

    res.json({
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
    });
  } catch (err) {
    console.error('My group error:', err);
    res.status(500).json({ error: 'Failed to fetch my group schedule' });
  }
});

export default router;
