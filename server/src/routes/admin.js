import { Router } from 'express';
import multer from 'multer';
import { query } from '../config/db.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import { importTimetable } from '../services/timetableImport.js';
import { isValidDateStr } from '../utils/timezone.js';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

/**
 * POST /api/admin/events
 * Create a one-off event for a room.
 */
router.post('/events', authenticate, requireAdmin, async (req, res) => {
  try {
    const { roomId, title, startAt, endAt } = req.body;

    if (!roomId || !title || !startAt || !endAt) {
      return res.status(400).json({
        error: 'Missing fields',
        message: 'roomId, title, startAt, and endAt are required.',
      });
    }

    const start = new Date(startAt);
    const end = new Date(endAt);

    if (start >= end) {
      return res.status(400).json({
        error: 'Invalid time range',
        message: 'Start time must be before end time.',
      });
    }

    // Check for clashes
    const clashRes = await query(`
      SELECT id, title FROM events
      WHERE room_id = $1
        AND start_at < $3
        AND end_at > $2
    `, [roomId, start, end]);

    if (clashRes.rows.length > 0) {
      return res.status(409).json({
        error: 'Time clash',
        message: `Clashes with event: "${clashRes.rows[0].title}"`,
        clashing: clashRes.rows,
      });
    }

    const result = await query(`
      INSERT INTO events (room_id, title, start_at, end_at, created_by)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *;
    `, [roomId, title, start, end, req.user.id]);

    res.status(201).json({ event: result.rows[0] });
  } catch (err) {
    console.error('Create event error:', err);
    res.status(500).json({ error: 'Failed to create event' });
  }
});

/**
 * DELETE /api/admin/events/:id
 * Cancel/delete an event.
 */
router.delete('/events/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const eventId = parseInt(req.params.id, 10);

    const result = await query('DELETE FROM events WHERE id = $1 RETURNING *', [eventId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Event not found' });
    }

    res.json({ message: 'Event deleted', event: result.rows[0] });
  } catch (err) {
    console.error('Delete event error:', err);
    res.status(500).json({ error: 'Failed to delete event' });
  }
});

/**
 * POST /api/admin/cancel-class
 * Cancel a single occurrence of a recurring class.
 */
router.post('/cancel-class', authenticate, requireAdmin, async (req, res) => {
  try {
    const { timetableEntryId, date, reason } = req.body;

    if (!timetableEntryId || !date) {
      return res.status(400).json({
        error: 'Missing fields',
        message: 'timetableEntryId and date are required.',
      });
    }

    // Verify the timetable entry exists
    const entryRes = await query(
      'SELECT * FROM timetable_entries WHERE id = $1',
      [timetableEntryId]
    );

    if (entryRes.rows.length === 0) {
      return res.status(404).json({ error: 'Timetable entry not found' });
    }

    const result = await query(`
      INSERT INTO schedule_exceptions (timetable_entry_id, date, reason, created_by)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (timetable_entry_id, date) DO NOTHING
      RETURNING *;
    `, [timetableEntryId, date, reason || 'Cancelled', req.user.id]);

    if (result.rows.length === 0) {
      return res.status(409).json({
        error: 'Already cancelled',
        message: 'This class was already cancelled for this date.',
      });
    }

    res.status(201).json({
      message: 'Class cancelled for this date',
      exception: result.rows[0],
    });
  } catch (err) {
    console.error('Cancel class error:', err);
    res.status(500).json({ error: 'Failed to cancel class' });
  }
});

/**
 * GET /api/admin/timetable
 * Get all timetable entries, optionally filtered by room.
 */
router.get('/timetable', authenticate, requireAdmin, async (req, res) => {
  try {
    const roomId = req.query.roomId ? parseInt(req.query.roomId, 10) : null;

    let sql = `
      SELECT te.*, r.name as room_name, r.floor
      FROM timetable_entries te
      JOIN rooms r ON te.room_id = r.id
    `;
    const params = [];

    if (roomId) {
      params.push(roomId);
      sql += ` WHERE te.room_id = $${params.length}`;
    }

    sql += ' ORDER BY te.day_of_week, te.start_time';

    const result = await query(sql, params);
    res.json({ entries: result.rows });
  } catch (err) {
    console.error('Timetable list error:', err);
    res.status(500).json({ error: 'Failed to fetch timetable' });
  }
});

/**
 * GET /api/admin/events
 * List upcoming events.
 */
router.get('/events', authenticate, requireAdmin, async (req, res) => {
  try {
    const result = await query(`
      SELECT e.*, r.name as room_name, r.floor
      FROM events e
      JOIN rooms r ON e.room_id = r.id
      WHERE e.end_at > NOW()
      ORDER BY e.start_at
    `);
    res.json({ events: result.rows });
  } catch (err) {
    console.error('Events list error:', err);
    res.status(500).json({ error: 'Failed to fetch events' });
  }
});

/**
 * POST /api/admin/timetable/import
 * Upload the weekly .xlsx timetable, validate it, and save valid rows.
 *
 * multipart/form-data fields:
 *   file                (required) .xlsx export of the Google Sheet
 *   validFrom, validTo  (required) YYYY-MM-DD dates the timetable applies to
 *   buildingId          (optional, default 1)
 *   saveValidRowsOnly   (optional) "true" to save good rows even if some fail
 */
router.post('/timetable/import', authenticate, requireAdmin, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        error: 'Missing file',
        message: 'Upload the timetable as an .xlsx file in the "file" field.',
      });
    }

    const name = (req.file.originalname || '').toLowerCase();
    if (!name.endsWith('.xlsx') && !name.endsWith('.xls')) {
      return res.status(400).json({
        error: 'Invalid file type',
        message: 'Only .xlsx (Google Sheets export) or .xls files are supported.',
      });
    }

    const buildingId = parseInt(req.body.buildingId || '1', 10);
    const { validFrom, validTo } = req.body;
    const saveValidRowsOnly = String(req.body.saveValidRowsOnly) === 'true';

    if (!Number.isInteger(buildingId) || buildingId < 1) {
      return res.status(400).json({
        error: 'Invalid building',
        message: 'buildingId must be a positive integer.',
      });
    }

    if (!isValidDateStr(validFrom) || !isValidDateStr(validTo)) {
      return res.status(400).json({
        error: 'Invalid dates',
        message: 'validFrom and validTo must be real dates in YYYY-MM-DD format.',
      });
    }

    if (validFrom > validTo) {
      return res.status(400).json({
        error: 'Invalid range',
        message: 'validFrom must be on or before validTo.',
      });
    }

    const report = await importTimetable({
      buffer: req.file.buffer,
      buildingId,
      validFrom,
      validTo,
      saveValidRowsOnly,
    });

    return res.status(report.committed ? 200 : 400).json(report);
  } catch (err) {
    if (err.code === 'NO_TIMETABLE_SHEET' || err.code === 'NO_ROOMS') {
      return res.status(400).json({ error: 'Import failed', message: err.message });
    }
    console.error('Timetable import error:', err);
    res.status(500).json({ error: 'Failed to import timetable' });
  }
});

/**
 * GET /api/admin/room-aliases
 * List room aliases used to map inconsistent timetable room names.
 */
router.get('/room-aliases', authenticate, requireAdmin, async (req, res) => {
  try {
    const result = await query(`
      SELECT a.id, a.alias, a.room_id, r.name AS room_name, r.floor
      FROM room_aliases a
      JOIN rooms r ON r.id = a.room_id
      ORDER BY a.alias
    `);
    res.json({ aliases: result.rows });
  } catch (err) {
    console.error('Alias list error:', err);
    res.status(500).json({ error: 'Failed to fetch room aliases' });
  }
});

/**
 * POST /api/admin/room-aliases
 * Map a timetable spelling to a room.
 */
router.post('/room-aliases', authenticate, requireAdmin, async (req, res) => {
  try {
    const { alias, roomId } = req.body;

    if (!alias || typeof alias !== 'string' || !alias.trim()) {
      return res.status(400).json({
        error: 'Missing alias',
        message: 'alias is required.',
      });
    }

    const parsedRoomId = parseInt(roomId, 10);
    if (!Number.isInteger(parsedRoomId) || parsedRoomId < 1) {
      return res.status(400).json({
        error: 'Invalid room',
        message: 'roomId must be a positive integer.',
      });
    }

    const roomRes = await query('SELECT id FROM rooms WHERE id = $1', [parsedRoomId]);
    if (roomRes.rows.length === 0) {
      return res.status(404).json({ error: 'Room not found' });
    }

    const result = await query(`
      INSERT INTO room_aliases (alias, room_id)
      VALUES ($1, $2)
      ON CONFLICT (alias) DO UPDATE SET room_id = EXCLUDED.room_id
      RETURNING *
    `, [alias.trim(), parsedRoomId]);

    res.status(201).json({ alias: result.rows[0] });
  } catch (err) {
    console.error('Alias create error:', err);
    res.status(500).json({ error: 'Failed to save room alias' });
  }
});

/**
 * DELETE /api/admin/room-aliases/:id
 */
router.delete('/room-aliases/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const aliasId = parseInt(req.params.id, 10);
    const result = await query('DELETE FROM room_aliases WHERE id = $1 RETURNING *', [aliasId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Alias not found' });
    }

    res.json({ message: 'Alias deleted', alias: result.rows[0] });
  } catch (err) {
    console.error('Alias delete error:', err);
    res.status(500).json({ error: 'Failed to delete room alias' });
  }
});

export default router;
