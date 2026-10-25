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
 * GET /api/admin/terms
 * List all terms with their associated batch year.
 */
router.get('/terms', authenticate, requireAdmin, async (req, res) => {
  try {
    const result = await query(`
      SELECT t.id, t.batch_id, b.year as batch_year, t.semester_number, t.term_number,
             t.start_date, t.end_date, t.created_at
      FROM terms t
      JOIN batches b ON b.id = t.batch_id
      ORDER BY b.year DESC, t.term_number ASC
    `);
    res.json({ terms: result.rows });
  } catch (err) {
    console.error('Fetch terms error:', err);
    res.status(500).json({ error: 'Failed to fetch terms' });
  }
});

/**
 * POST /api/admin/terms
 * Create a new term for a batch.
 */
router.post('/terms', authenticate, requireAdmin, async (req, res) => {
  try {
    const { batchYear, semesterNumber, termNumber, startDate, endDate } = req.body;

    if (!batchYear || !semesterNumber || !termNumber || !startDate || !endDate) {
      return res.status(400).json({
        error: 'Missing fields',
        message: 'batchYear, semesterNumber, termNumber, startDate, and endDate are required.',
      });
    }

    if (!isValidDateStr(startDate) || !isValidDateStr(endDate)) {
      return res.status(400).json({
        error: 'Invalid dates',
        message: 'startDate and endDate must be real dates in YYYY-MM-DD format.',
      });
    }

    if (startDate > endDate) {
      return res.status(400).json({
        error: 'Invalid date range',
        message: 'startDate must be on or before endDate.',
      });
    }

    const bYear = parseInt(batchYear, 10);
    const semNum = parseInt(semesterNumber, 10);
    const tNum = parseInt(termNumber, 10);

    // Upsert or find batch
    let batchRes = await query('SELECT id FROM batches WHERE year = $1', [bYear]);
    let batchId;
    if (batchRes.rows.length === 0) {
      const newBatch = await query('INSERT INTO batches (year) VALUES ($1) RETURNING id', [bYear]);
      batchId = newBatch.rows[0].id;
    } else {
      batchId = batchRes.rows[0].id;
    }

    // Check duplicate term number for this batch
    const dupRes = await query('SELECT id FROM terms WHERE batch_id = $1 AND term_number = $2', [batchId, tNum]);
    if (dupRes.rows.length > 0) {
      return res.status(409).json({
        error: 'Duplicate term',
        message: `Term ${tNum} already exists for Batch ${bYear}.`,
      });
    }

    // Check same-batch date overlap (C11 rule: terms of same batch cannot overlap)
    const overlapRes = await query(`
      SELECT id, term_number, start_date, end_date
      FROM terms
      WHERE batch_id = $1
        AND start_date <= $3
        AND end_date >= $2
    `, [batchId, startDate, endDate]);

    if (overlapRes.rows.length > 0) {
      const clash = overlapRes.rows[0];
      const startStr = clash.start_date instanceof Date ? clash.start_date.toISOString().slice(0, 10) : String(clash.start_date).slice(0, 10);
      const endStr = clash.end_date instanceof Date ? clash.end_date.toISOString().slice(0, 10) : String(clash.end_date).slice(0, 10);
      return res.status(409).json({
        error: 'Overlapping term',
        message: `Term dates overlap with Term ${clash.term_number} (${startStr} to ${endStr}) for Batch ${bYear}.`,
      });
    }

    const result = await query(`
      INSERT INTO terms (batch_id, semester_number, term_number, start_date, end_date)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `, [batchId, semNum, tNum, startDate, endDate]);

    res.status(201).json({
      term: {
        ...result.rows[0],
        batch_year: bYear,
      },
    });
  } catch (err) {
    console.error('Create term error:', err);
    res.status(500).json({ error: 'Failed to create term' });
  }
});

/**
 * GET /api/admin/timetable
 * Get all timetable entries, optionally filtered by room or term.
 */
router.get('/timetable', authenticate, requireAdmin, async (req, res) => {
  try {
    const roomId = req.query.roomId ? parseInt(req.query.roomId, 10) : null;
    const termId = req.query.termId ? parseInt(req.query.termId, 10) : null;

    let sql = `
      SELECT te.*, r.name as room_name, r.floor,
             t.term_number, b.year as batch_year
      FROM timetable_entries te
      JOIN rooms r ON te.room_id = r.id
      LEFT JOIN terms t ON te.term_id = t.id
      LEFT JOIN batches b ON t.batch_id = b.id
    `;
    const params = [];
    const conditions = [];

    if (roomId) {
      params.push(roomId);
      conditions.push(`te.room_id = $${params.length}`);
    }
    if (termId) {
      params.push(termId);
      conditions.push(`te.term_id = $${params.length}`);
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
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
 *   termId              (preferred) ID of the batch's term record
 *   batchYear, termNumber (alternative to termId)
 *   validFrom, validTo  (legacy fallback) YYYY-MM-DD dates the timetable applies to
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
    const saveValidRowsOnly = String(req.body.saveValidRowsOnly) === 'true';

    if (!Number.isInteger(buildingId) || buildingId < 1) {
      return res.status(400).json({
        error: 'Invalid building',
        message: 'buildingId must be a positive integer.',
      });
    }

    let termId = req.body.termId ? parseInt(req.body.termId, 10) : null;
    let validFrom = req.body.validFrom;
    let validTo = req.body.validTo;

    // Look up term if termId or batchYear + termNumber provided
    if (!termId && req.body.batchYear && req.body.termNumber) {
      const termLookup = await query(`
        SELECT t.id, t.start_date, t.end_date, b.year as batch_year
        FROM terms t
        JOIN batches b ON b.id = t.batch_id
        WHERE b.year = $1 AND t.term_number = $2
      `, [parseInt(req.body.batchYear, 10), parseInt(req.body.termNumber, 10)]);

      if (termLookup.rows.length === 0) {
        return res.status(404).json({
          error: 'Term not found',
          message: `No term record found for Batch ${req.body.batchYear} Term ${req.body.termNumber}. Please create the term first.`,
        });
      }
      termId = termLookup.rows[0].id;
    }

    if (termId) {
      const termRes = await query(`
        SELECT t.id, t.start_date, t.end_date, b.year as batch_year, t.term_number
        FROM terms t
        JOIN batches b ON b.id = t.batch_id
        WHERE t.id = $1
      `, [termId]);

      if (termRes.rows.length === 0) {
        return res.status(404).json({
          error: 'Term not found',
          message: 'The specified term does not exist.',
        });
      }

      const term = termRes.rows[0];
      validFrom = term.start_date instanceof Date
        ? term.start_date.toISOString().slice(0, 10)
        : String(term.start_date).slice(0, 10);
      validTo = term.end_date instanceof Date
        ? term.end_date.toISOString().slice(0, 10)
        : String(term.end_date).slice(0, 10);
    }

    if (!isValidDateStr(validFrom) || !isValidDateStr(validTo)) {
      return res.status(400).json({
        error: 'Invalid dates',
        message: 'A valid term (or validFrom and validTo in YYYY-MM-DD format) is required.',
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
      filename: req.file.originalname,
      buildingId,
      termId,
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

// ── Closures (C6, C8, C11) ───────────────────────────────────

/**
 * GET /api/admin/closures
 * List all closures with room/building and creator details.
 */
router.get('/closures', authenticate, requireAdmin, async (req, res) => {
  try {
    const result = await query(`
      SELECT
        c.*,
        r.name AS room_name,
        b.name AS building_name,
        u.name AS creator_name,
        u.email AS creator_email
      FROM closures c
      LEFT JOIN rooms r ON r.id = c.room_id
      LEFT JOIN buildings b ON b.id = c.building_id
      LEFT JOIN users u ON u.id = c.created_by
      ORDER BY c.start_date DESC, c.start_time ASC NULLS FIRST, c.id DESC
    `);
    res.json({ closures: result.rows });
  } catch (err) {
    console.error('Fetch closures error:', err);
    res.status(500).json({ error: 'Failed to fetch closures' });
  }
});

/**
 * POST /api/admin/closures
 * Create or merge an exam or emergency closure.
 */
router.post('/closures', authenticate, requireAdmin, async (req, res) => {
  try {
    const {
      scope,
      buildingId = 1,
      roomId,
      floor,
      startDate,
      endDate,
      startTime,
      endTime,
      reason = 'Exam',
      note,
    } = req.body;

    // Validate scope
    if (!['room', 'floor', 'building'].includes(scope)) {
      return res.status(400).json({
        error: 'Invalid scope',
        message: 'Scope must be room, floor, or building.',
      });
    }

    // Validate dates
    if (!startDate || !isValidDateStr(startDate)) {
      return res.status(400).json({
        error: 'Invalid start date',
        message: 'startDate is required and must be in YYYY-MM-DD format.',
      });
    }

    const finalEndDate = endDate || startDate;
    if (!isValidDateStr(finalEndDate)) {
      return res.status(400).json({
        error: 'Invalid end date',
        message: 'endDate must be in YYYY-MM-DD format.',
      });
    }

    if (finalEndDate < startDate) {
      return res.status(400).json({
        error: 'Invalid date range',
        message: 'End date must be on or after start date.',
      });
    }

    // Validate optional time range
    let finalStartTime = startTime ? startTime.trim().slice(0, 5) : null;
    let finalEndTime = endTime ? endTime.trim().slice(0, 5) : null;

    if (finalStartTime || finalEndTime) {
      if (!finalStartTime || !finalEndTime) {
        return res.status(400).json({
          error: 'Incomplete time range',
          message: 'Both start time and end time must be specified, or leave both blank for whole-day closure.',
        });
      }
      if (finalStartTime >= finalEndTime) {
        return res.status(400).json({
          error: 'Invalid time range',
          message: 'End time must be after start time.',
        });
      }
    }

    let parsedRoomId = null;
    let finalFloor = null;
    let resolvedBuildingId = parseInt(buildingId, 10) || 1;

    // Scope-specific validation
    if (scope === 'room') {
      parsedRoomId = parseInt(roomId, 10);
      if (!Number.isInteger(parsedRoomId) || parsedRoomId < 1) {
        return res.status(400).json({
          error: 'Missing room',
          message: 'roomId is required when scope is room.',
        });
      }
      const roomCheck = await query('SELECT id, building_id, floor FROM rooms WHERE id = $1', [parsedRoomId]);
      if (roomCheck.rows.length === 0) {
        return res.status(404).json({
          error: 'Room not found',
          message: `Room with id ${parsedRoomId} does not exist.`,
        });
      }
      resolvedBuildingId = roomCheck.rows[0].building_id;
      finalFloor = roomCheck.rows[0].floor;
    } else if (scope === 'floor') {
      if (!floor || !floor.trim()) {
        return res.status(400).json({
          error: 'Missing floor',
          message: 'floor is required when scope is floor.',
        });
      }
      finalFloor = floor.trim();
      const floorCheck = await query(
        'SELECT 1 FROM rooms WHERE building_id = $1 AND LOWER(TRIM(floor)) = LOWER(TRIM($2)) LIMIT 1',
        [resolvedBuildingId, finalFloor]
      );
      if (floorCheck.rows.length === 0) {
        return res.status(404).json({
          error: 'Floor not found',
          message: `Floor "${finalFloor}" does not exist in building ${resolvedBuildingId}.`,
        });
      }
    }

    // Warning for past dates (C11)
    const today = new Date().toISOString().split('T')[0];
    let warning = null;
    if (startDate < today) {
      warning = 'Closure is scheduled in the past. Recorded for historical accuracy.';
    }

    // Merge check (C11: "Overlapping closures are merged, not stored twice")
    const existingRes = await query(
      `SELECT * FROM closures
       WHERE scope = $1
         AND (
           ($1 = 'building' AND (building_id IS NULL OR building_id = $2))
           OR ($1 = 'floor' AND LOWER(TRIM(floor)) = LOWER(TRIM($3)))
           OR ($1 = 'room' AND room_id = $4)
         )
         AND start_date <= $6
         AND end_date >= $5`,
      [scope, resolvedBuildingId, finalFloor, parsedRoomId, startDate, finalEndDate]
    );

    // Check time overlap
    const overlapping = existingRes.rows.filter((c) => {
      if (!c.start_time && !finalStartTime) return true;
      if (!c.start_time || !finalStartTime) return true;
      const cStart = String(c.start_time).slice(0, 5);
      const cEnd = String(c.end_time).slice(0, 5);
      return cStart < finalEndTime && cEnd > finalStartTime;
    });

    if (overlapping.length > 0) {
      const target = overlapping[0];
      const mergedStart = target.start_date < startDate ? target.start_date : startDate;
      const mergedEnd = target.end_date > finalEndDate ? target.end_date : finalEndDate;
      let mergedStartTime = target.start_time;
      let mergedEndTime = target.end_time;

      if (!target.start_time || !finalStartTime) {
        mergedStartTime = null;
        mergedEndTime = null;
      } else {
        const tStart = String(target.start_time).slice(0, 5);
        const tEnd = String(target.end_time).slice(0, 5);
        mergedStartTime = tStart < finalStartTime ? tStart : finalStartTime;
        mergedEndTime = tEnd > finalEndTime ? tEnd : finalEndTime;
      }

      const mergedNote = [target.note, note].filter(Boolean).join('; ');

      const updateRes = await query(
        `UPDATE closures
         SET start_date = $1, end_date = $2, start_time = $3, end_time = $4,
             reason = COALESCE($5, reason), note = $6
         WHERE id = $7
         RETURNING *`,
        [mergedStart, mergedEnd, mergedStartTime, mergedEndTime, reason.trim() || target.reason, mergedNote || null, target.id]
      );

      return res.status(200).json({
        closure: updateRes.rows[0],
        merged: true,
        message: 'Merged with existing overlapping closure.',
        warning,
      });
    }

    // Insert new closure
    const insertRes = await query(
      `INSERT INTO closures
         (scope, building_id, room_id, floor, start_date, end_date, start_time, end_time, reason, note, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [
        scope,
        resolvedBuildingId,
        parsedRoomId,
        finalFloor,
        startDate,
        finalEndDate,
        finalStartTime,
        finalEndTime,
        reason.trim() || 'Exam',
        note ? note.trim() : null,
        req.user.id,
      ]
    );

    res.status(201).json({
      closure: insertRes.rows[0],
      merged: false,
      warning,
    });
  } catch (err) {
    console.error('Closure creation error:', err);
    res.status(500).json({ error: 'Failed to create closure' });
  }
});

/**
 * DELETE /api/admin/closures/:id
 */
router.delete('/closures/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const closureId = parseInt(req.params.id, 10);
    const result = await query('DELETE FROM closures WHERE id = $1 RETURNING *', [closureId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Closure not found' });
    }

    res.json({ message: 'Closure deleted', closure: result.rows[0] });
  } catch (err) {
    console.error('Delete closure error:', err);
    res.status(500).json({ error: 'Failed to delete closure' });
  }
});

// ── No-Class Days (C12: Holidays and Breaks) ─────────────────

/**
 * GET /api/admin/no-class-days
 */
router.get('/no-class-days', authenticate, requireAdmin, async (req, res) => {
  try {
    const result = await query(`
      SELECT n.*, u.name as creator_name
      FROM no_class_days n
      LEFT JOIN users u ON u.id = n.created_by
      ORDER BY n.date ASC
    `);
    res.json({ noClassDays: result.rows });
  } catch (err) {
    console.error('Fetch no-class-days error:', err);
    res.status(500).json({ error: 'Failed to fetch no-class days' });
  }
});

/**
 * POST /api/admin/no-class-days
 */
router.post('/no-class-days', authenticate, requireAdmin, async (req, res) => {
  try {
    const { date, reason = 'Holiday', buildingId = 1 } = req.body;
    if (!date || !isValidDateStr(date)) {
      return res.status(400).json({ error: 'Invalid date', message: 'date must be in YYYY-MM-DD format.' });
    }
    const result = await query(`
      INSERT INTO no_class_days (building_id, date, reason, created_by)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (building_id, date) DO UPDATE SET reason = EXCLUDED.reason
      RETURNING *
    `, [buildingId, date, reason.trim() || 'Holiday', req.user.id]);
    res.status(201).json({ noClassDay: result.rows[0] });
  } catch (err) {
    console.error('Create no-class-day error:', err);
    res.status(500).json({ error: 'Failed to save no-class day' });
  }
});

/**
 * DELETE /api/admin/no-class-days/:id
 */
router.delete('/no-class-days/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const result = await query('DELETE FROM no_class_days WHERE id = $1 RETURNING *', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'No-class day not found' });
    }
    res.json({ message: 'No-class day deleted', noClassDay: result.rows[0] });
  } catch (err) {
    console.error('Delete no-class-day error:', err);
    res.status(500).json({ error: 'Failed to delete no-class day' });
  }
});

export default router;
