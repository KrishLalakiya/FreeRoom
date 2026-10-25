import { Router } from 'express';
import { query } from '../config/db.js';
import { getFreeRoomsNow, getFreeRoomsForWindow, getRoomTimeline } from '../services/availabilityEngine.js';
import { authenticate } from '../middleware/auth.js';
import { toDateStr, isValidDateStr } from '../utils/timezone.js';

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
      coverage: result.coverage,
      count: result.rooms.length,
      rooms: result.rooms,
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
      coverage: result.coverage,
      count: result.rooms.length,
      rooms: result.rooms,
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

export default router;
