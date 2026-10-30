import { Router } from 'express';
import multer from 'multer';
import { query, getClient } from '../config/db.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import { importTimetable } from '../services/timetableImport.js';
import { isValidDateStr, toDateStr } from '../utils/timezone.js';
import { clearAvailabilityCache } from '../services/cache.js';
import { getSystemSettings, updateSystemSettings } from '../services/systemSettings.js';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

// Ensure admin_actions table exists
async function ensureAdminActionsTable() {
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS admin_actions (
        id          SERIAL PRIMARY KEY,
        admin_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
        admin_name  VARCHAR(255) NOT NULL,
        action_type VARCHAR(100) NOT NULL,
        description TEXT NOT NULL,
        details     JSONB,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await query(`
      CREATE INDEX IF NOT EXISTS idx_admin_actions_created_at
      ON admin_actions (created_at DESC);
    `);
  } catch (err) {
    console.error('Failed to ensure admin_actions table:', err);
  }
}
ensureAdminActionsTable();

export async function logAdminAction(req, actionType, description, details = null) {
  try {
    const adminId = req.user?.id || null;
    let adminName = req.user?.name || req.user?.email || 'Admin';
    if (!req.user?.name && req.user?.id) {
      const uRes = await query('SELECT name, email FROM users WHERE id = $1', [req.user.id]);
      if (uRes.rows[0]) {
        adminName = uRes.rows[0].name || uRes.rows[0].email || 'Admin';
      }
    }
    await query(`
      INSERT INTO admin_actions (admin_id, admin_name, action_type, description, details)
      VALUES ($1, $2, $3, $4, $5)
    `, [adminId, adminName, actionType, description, details ? JSON.stringify(details) : null]);
  } catch (err) {
    console.error('Failed to log admin action:', err);
  }
}

// PRD v6 Section 5 & PRD v5 Section 8: Strictly check admin role for every admin route
router.use(authenticate, requireAdmin);

/**
 * GET /api/admin/action-logs
 * List recent admin actions (PRD v5).
 */
router.get('/action-logs', async (req, res) => {
  try {
    const result = await query(`
      SELECT id, admin_id, admin_name, action_type, description, details, created_at
      FROM admin_actions
      ORDER BY created_at DESC
      LIMIT 100
    `);
    res.json({ actions: result.rows });
  } catch (err) {
    console.error('Fetch action logs error:', err);
    res.status(500).json({ error: 'Failed to fetch action logs' });
  }
});

/**
 * POST /api/admin/events
 * Create a one-off event for a room.
 */
router.post('/events', async (req, res) => {
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

    const client = await getClient();
    try {
      await client.query('BEGIN');
      // Lock room to prevent double-booking race condition (PRD v9 item 17)
      await client.query('SELECT id FROM rooms WHERE id = $1 FOR UPDATE', [roomId]);

      // Check for clashes
      const clashRes = await client.query(`
        SELECT id, title FROM events
        WHERE room_id = $1
          AND start_at < $3
          AND end_at > $2
      `, [roomId, start, end]);

      if (clashRes.rows.length > 0) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: 'Time clash',
          message: `Clashes with event: "${clashRes.rows[0].title}"`,
          clashing: clashRes.rows,
        });
      }

      const result = await client.query(`
        INSERT INTO events (room_id, title, start_at, end_at, created_by)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING *;
      `, [roomId, title, start, end, req.user.id]);

      await client.query('COMMIT');

      clearAvailabilityCache({ roomId });
      await logAdminAction(req, 'create_event', `Created one-off event "${title}" in Room #${roomId}`, { roomId, title, startAt, endAt });

      res.status(201).json({ event: result.rows[0] });
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Create event error:', err);
    res.status(500).json({ error: 'Failed to create event' });
  }
});

/**
 * DELETE /api/admin/events/:id
 * Cancel/delete an event.
 */
router.delete('/events/:id', async (req, res) => {
  try {
    const eventId = parseInt(req.params.id, 10);

    const result = await query('DELETE FROM events WHERE id = $1 RETURNING *', [eventId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Event not found' });
    }

    clearAvailabilityCache({ roomId: result.rows[0].room_id });
    await logAdminAction(req, 'delete_event', `Deleted one-off event "${result.rows[0].title}"`, { eventId });

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
router.post('/cancel-class', async (req, res) => {
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

    clearAvailabilityCache();
    await logAdminAction(req, 'cancel_class', `Cancelled class occurrence for ${date}: ${reason || 'No reason specified'}`, { timetableEntryId, date, reason });

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
router.get('/terms', async (req, res) => {
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
router.post('/terms', async (req, res) => {
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

    const client = await getClient();
    try {
      await client.query('BEGIN');

      // Upsert or find batch (lock batch to prevent orphan batch on failure, PRD v9 item 18 & 22)
      let batchRes = await client.query('SELECT id FROM batches WHERE year = $1 FOR UPDATE', [bYear]);
      let batchId;
      if (batchRes.rows.length === 0) {
        const newBatch = await client.query('INSERT INTO batches (year) VALUES ($1) RETURNING id', [bYear]);
        batchId = newBatch.rows[0].id;
      } else {
        batchId = batchRes.rows[0].id;
      }

      // Check duplicate term number for this batch
      const dupRes = await client.query('SELECT id FROM terms WHERE batch_id = $1 AND term_number = $2', [batchId, tNum]);
      if (dupRes.rows.length > 0) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: 'Duplicate term',
          message: `Term ${tNum} already exists for Batch ${bYear}.`,
        });
      }

      // Check same-batch date overlap (C11 rule: terms of same batch cannot overlap)
      const overlapRes = await client.query(`
        SELECT id, term_number, start_date, end_date
        FROM terms
        WHERE batch_id = $1
          AND start_date <= $3
          AND end_date >= $2
      `, [batchId, startDate, endDate]);

      if (overlapRes.rows.length > 0) {
        await client.query('ROLLBACK');
        const clash = overlapRes.rows[0];
        const startStr = clash.start_date instanceof Date ? toDateStr(clash.start_date) : String(clash.start_date).slice(0, 10);
        const endStr = clash.end_date instanceof Date ? toDateStr(clash.end_date) : String(clash.end_date).slice(0, 10);
        return res.status(409).json({
          error: 'Overlapping term',
          message: `Term dates overlap with Term ${clash.term_number} (${startStr} to ${endStr}) for Batch ${bYear}.`,
        });
      }

      const result = await client.query(`
        INSERT INTO terms (batch_id, semester_number, term_number, start_date, end_date)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING *
      `, [batchId, semNum, tNum, startDate, endDate]);

      await client.query('COMMIT');

      clearAvailabilityCache();
      await logAdminAction(req, 'create_term', `Added Term ${tNum} (Batch ${bYear}) from ${startDate} to ${endDate}`, req.body);

      res.status(201).json({
        term: {
          ...result.rows[0],
          batch_year: bYear,
        },
      });
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Create term error:', err);
    res.status(500).json({ error: 'Failed to create term' });
  }
});

/**
 * PUT /api/admin/terms/:id
 * Update an existing term.
 */
router.put('/terms/:id', async (req, res) => {
  try {
    const termId = parseInt(req.params.id, 10);
    const { semesterNumber, termNumber, startDate, endDate } = req.body;

    const existingRes = await query('SELECT * FROM terms WHERE id = $1', [termId]);
    if (existingRes.rows.length === 0) {
      return res.status(404).json({ error: 'Term not found' });
    }
    const current = existingRes.rows[0];

    // PRD v9 item 20: use toDateStr to prevent Date objects from failing isValidDateStr
    const sDate = startDate || toDateStr(current.start_date);
    const eDate = endDate || toDateStr(current.end_date);
    const semNum = semesterNumber !== undefined ? parseInt(semesterNumber, 10) : current.semester_number;
    const tNum = termNumber !== undefined ? parseInt(termNumber, 10) : current.term_number;

    if (!isValidDateStr(sDate) || !isValidDateStr(eDate)) {
      return res.status(400).json({
        error: 'Invalid dates',
        message: 'startDate and endDate must be real dates in YYYY-MM-DD format.',
      });
    }

    if (sDate > eDate) {
      return res.status(400).json({
        error: 'Invalid date range',
        message: 'startDate must be on or before endDate.',
      });
    }

    const client = await getClient();
    try {
      await client.query('BEGIN');

      // Check duplicate term number for this batch (excluding this term)
      const dupRes = await client.query(
        'SELECT id FROM terms WHERE batch_id = $1 AND term_number = $2 AND id != $3',
        [current.batch_id, tNum, termId]
      );
      if (dupRes.rows.length > 0) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: 'Duplicate term',
          message: `Term ${tNum} already exists for this batch.`,
        });
      }

      // Check same-batch date overlap (C11 rule: terms of same batch cannot overlap)
      const overlapRes = await client.query(`
        SELECT id, term_number, start_date, end_date
        FROM terms
        WHERE batch_id = $1
          AND id != $4
          AND start_date <= $3
          AND end_date >= $2
      `, [current.batch_id, sDate, eDate, termId]);

      if (overlapRes.rows.length > 0) {
        await client.query('ROLLBACK');
        const clash = overlapRes.rows[0];
        const startStr = clash.start_date instanceof Date ? toDateStr(clash.start_date) : String(clash.start_date).slice(0, 10);
        const endStr = clash.end_date instanceof Date ? toDateStr(clash.end_date) : String(clash.end_date).slice(0, 10);
        return res.status(409).json({
          error: 'Overlapping term',
          message: `Term dates overlap with Term ${clash.term_number} (${startStr} to ${endStr}).`,
        });
      }

      const result = await client.query(`
        UPDATE terms
        SET semester_number = $1, term_number = $2, start_date = $3, end_date = $4
        WHERE id = $5
        RETURNING *
      `, [semNum, tNum, sDate, eDate, termId]);

      await client.query('COMMIT');

      clearAvailabilityCache();
      await logAdminAction(req, 'update_term', `Updated Term #${termId} (Term ${tNum}) dates to ${sDate} – ${eDate}`, req.body);

      res.json({ term: result.rows[0] });
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Update term error:', err);
    res.status(500).json({ error: 'Failed to update term' });
  }
});

/**
 * DELETE /api/admin/terms/:id
 * Delete a term and its associated timetable entries (via cascade).
 */
router.delete('/terms/:id', async (req, res) => {
  try {
    const termId = parseInt(req.params.id, 10);
    const result = await query('DELETE FROM terms WHERE id = $1 RETURNING *', [termId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Term not found' });
    }

    clearAvailabilityCache();
    await logAdminAction(req, 'delete_term', `Deleted Term #${termId}`, { termId });

    res.json({ message: 'Term deleted', term: result.rows[0] });
  } catch (err) {
    console.error('Delete term error:', err);
    res.status(500).json({ error: 'Failed to delete term' });
  }
});

/**
 * GET /api/admin/timetable
 * Get all timetable entries, optionally filtered by room or term.
 */
router.get('/timetable', async (req, res) => {
  try {
    let roomId = null;
    if (req.query.roomId) {
      if (/^\d+$/.test(req.query.roomId)) {
        roomId = parseInt(req.query.roomId, 10);
      } else {
        const lookup = await query('SELECT id FROM rooms WHERE UPPER(name) = UPPER($1)', [req.query.roomId]);
        if (lookup.rows.length > 0) {
          roomId = lookup.rows[0].id;
        } else {
          // PRD v9 item 21: Unknown room must return empty array, not full timetable
          return res.json({ entries: [] });
        }
      }
    }
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

    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 500, 1), 1000);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
    sql += ` LIMIT ${params.length + 1} OFFSET ${params.length + 2}`;
    params.push(limit, offset);

    const result = await query(sql, params);
    res.json({ entries: result.rows, limit, offset });
  } catch (err) {
    console.error('Timetable list error:', err);
    res.status(500).json({ error: 'Failed to fetch timetable' });
  }
});

/**
 * GET /api/admin/events
 * List upcoming events.
 */
router.get('/events', async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 200, 1), 500);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

    const result = await query(`
      SELECT e.*, r.name as room_name, r.floor
      FROM events e
      JOIN rooms r ON e.room_id = r.id
      WHERE e.end_at > NOW()
      ORDER BY e.start_at
      LIMIT $1 OFFSET $2
    `, [limit, offset]);
    res.json({ events: result.rows, limit, offset });
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
router.post('/timetable/import', upload.single('file'), async (req, res) => {
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
        ? toDateStr(term.start_date)
        : String(term.start_date).slice(0, 10);
      validTo = term.end_date instanceof Date
        ? toDateStr(term.end_date)
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
      replace: req.body.replace === 'true' || req.body.replace === true,
    });

    if (report.committed) {
      clearAvailabilityCache();
      await logAdminAction(req, 'import_timetable', `Imported timetable file "${req.file.originalname}"`, { filename: req.file.originalname });
    }

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
router.get('/room-aliases', async (req, res) => {
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
router.post('/room-aliases', async (req, res) => {
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

    await logAdminAction(req, 'create_alias', `Mapped timetable alias "${alias.trim()}" to Room #${parsedRoomId}`, { alias: alias.trim(), roomId: parsedRoomId });

    res.status(201).json({ alias: result.rows[0] });
  } catch (err) {
    console.error('Alias create error:', err);
    res.status(500).json({ error: 'Failed to save room alias' });
  }
});

/**
 * DELETE /api/admin/room-aliases/:id
 */
router.delete('/room-aliases/:id', async (req, res) => {
  try {
    const aliasId = parseInt(req.params.id, 10);
    const result = await query('DELETE FROM room_aliases WHERE id = $1 RETURNING *', [aliasId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Alias not found' });
    }

    await logAdminAction(req, 'delete_alias', `Deleted room alias #${aliasId}`, { aliasId });

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
router.get('/closures', async (req, res) => {
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
router.post('/closures', async (req, res) => {
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
    const today = toDateStr(new Date());
    let warning = null;
    if (startDate < today) {
      warning = 'Closure is scheduled in the past. Recorded for historical accuracy.';
    }

    const client = await getClient();
    try {
      await client.query('BEGIN');

      // Merge check (C11: "Overlapping closures are merged, not stored twice", PRD v9 item 19 & 22)
      const existingRes = await client.query(
        `SELECT * FROM closures
         WHERE scope = $1
           AND (
             ($1 = 'building' AND (building_id IS NULL OR building_id = $2))
             OR ($1 = 'floor' AND LOWER(TRIM(floor)) = LOWER(TRIM($3)))
             OR ($1 = 'room' AND room_id = $4)
           )
           AND start_date <= $6
           AND end_date >= $5
         FOR UPDATE`,
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
        // PRD v9 item 19: target.start_date is a Date object, convert with toDateStr so string comparison works
        const targetStartStr = toDateStr(target.start_date);
        const targetEndStr = toDateStr(target.end_date);
        const mergedStart = targetStartStr < startDate ? targetStartStr : startDate;
        const mergedEnd = targetEndStr > finalEndDate ? targetEndStr : finalEndDate;
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

        const updateRes = await client.query(
          `UPDATE closures
           SET start_date = $1, end_date = $2, start_time = $3, end_time = $4,
               reason = COALESCE($5, reason), note = $6
           WHERE id = $7
           RETURNING *`,
          [mergedStart, mergedEnd, mergedStartTime, mergedEndTime, reason.trim() || target.reason, mergedNote || null, target.id]
        );

        await client.query('COMMIT');

        clearAvailabilityCache();

        return res.status(200).json({
          closure: updateRes.rows[0],
          merged: true,
          message: 'Merged with existing overlapping closure.',
          warning,
        });
      }

      // Insert new closure
      const insertRes = await client.query(
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

      await client.query('COMMIT');

      clearAvailabilityCache();
      await logAdminAction(req, 'create_closure', `Created ${scope} closure: ${reason.trim() || 'Exam'} (${startDate} to ${finalEndDate})`, req.body);

      res.status(201).json({
        closure: insertRes.rows[0],
        merged: false,
        warning,
      });
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Closure creation error:', err);
    res.status(500).json({ error: 'Failed to create closure' });
  }
});

/**
 * DELETE /api/admin/closures/:id
 */
router.delete('/closures/:id', async (req, res) => {
  try {
    const closureId = parseInt(req.params.id, 10);
    const result = await query('DELETE FROM closures WHERE id = $1 RETURNING *', [closureId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Closure not found' });
    }

    clearAvailabilityCache();
    await logAdminAction(req, 'delete_closure', `Deleted closure #${closureId}`, { closureId });

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
router.get('/no-class-days', async (req, res) => {
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
router.post('/no-class-days', async (req, res) => {
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
    clearAvailabilityCache({ buildingId });
    await logAdminAction(req, 'create_no_class_day', `Added holiday/break: ${reason.trim() || 'Holiday'} on ${date}`, { date, reason: reason.trim() });
    res.status(201).json({ noClassDay: result.rows[0] });
  } catch (err) {
    console.error('Create no-class-day error:', err);
    res.status(500).json({ error: 'Failed to save no-class day' });
  }
});

/**
 * DELETE /api/admin/no-class-days/:id
 */
router.delete('/no-class-days/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const result = await query('DELETE FROM no_class_days WHERE id = $1 RETURNING *', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'No-class day not found' });
    }
    clearAvailabilityCache();
    await logAdminAction(req, 'delete_no_class_day', `Deleted holiday/break #${id}`, { id });
    res.json({ message: 'No-class day deleted', noClassDay: result.rows[0] });
  } catch (err) {
    console.error('Delete no-class-day error:', err);
    res.status(500).json({ error: 'Failed to delete no-class day' });
  }
});

/**
 * GET /api/admin/settings
 * Get system settings (PRD v8: X minimum free minutes, buffer, chaining enabled)
 */
router.get('/settings', async (req, res) => {
  try {
    const settings = await getSystemSettings();
    res.json({ settings });
  } catch (err) {
    console.error('Fetch settings error:', err);
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

/**
 * PUT /api/admin/settings
 * Update system settings (PRD v8)
 */
router.put('/settings', async (req, res) => {
  try {
    const { chain_min_free_minutes, chain_enabled, buffer_minutes } = req.body;
    const updates = {};
    if (chain_min_free_minutes !== undefined) {
      const parsed = parseInt(chain_min_free_minutes, 10);
      if (!isNaN(parsed) && parsed >= 1) updates.chain_min_free_minutes = parsed;
    }
    if (typeof chain_enabled === 'boolean') {
      updates.chain_enabled = chain_enabled;
    }
    if (buffer_minutes !== undefined) {
      const parsed = parseInt(buffer_minutes, 10);
      if (!isNaN(parsed) && parsed >= 0) updates.buffer_minutes = parsed;
    }

    const settings = await updateSystemSettings(updates);
    await logAdminAction(req, 'update_settings', `Updated room chaining settings: X=${settings.chain_min_free_minutes}m, Chaining=${settings.chain_enabled ? 'On' : 'Off'}`, updates);
    res.json({ settings });
  } catch (err) {
    console.error('Update settings error:', err);
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

export default router;
