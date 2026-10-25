import { Router } from 'express';
import { query } from '../config/db.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';

const router = Router();

const REPORT_COOLDOWN_MINUTES = 15;
const AUTO_OVERRIDE_THRESHOLD = 5;
const ADMIN_FLAG_THRESHOLD = 3;

/**
 * POST /api/reports
 * Student reports a wrong room status.
 * Body: { roomId, reportedStatus: 'not_empty' | 'actually_free' }
 */
router.post('/', authenticate, async (req, res) => {
  try {
    const { roomId, reportedStatus } = req.body;

    if (!roomId || !reportedStatus) {
      return res.status(400).json({
        error: 'Missing fields',
        message: 'roomId and reportedStatus are required.',
      });
    }

    if (!['not_empty', 'actually_free'].includes(reportedStatus)) {
      return res.status(400).json({
        error: 'Invalid status',
        message: 'reportedStatus must be "not_empty" or "actually_free".',
      });
    }

    // Check for duplicate within cooldown period
    const recentReport = await query(`
      SELECT id FROM status_reports
      WHERE room_id = $1 AND user_id = $2
        AND created_at > NOW() - INTERVAL '${REPORT_COOLDOWN_MINUTES} minutes'
    `, [roomId, req.user.id]);

    if (recentReport.rows.length > 0) {
      return res.status(429).json({
        error: 'Too soon',
        message: `You can report again in ${REPORT_COOLDOWN_MINUTES} minutes.`,
      });
    }

    // Insert report
    await query(`
      INSERT INTO status_reports (room_id, user_id, reported_status)
      VALUES ($1, $2, $3)
    `, [roomId, req.user.id, reportedStatus]);

    // Count recent reports for this room with the same status
    const countRes = await query(`
      SELECT COUNT(*) as cnt FROM status_reports
      WHERE room_id = $1 AND reported_status = $2
        AND created_at > NOW() - INTERVAL '30 minutes'
    `, [roomId, reportedStatus]);

    const reportCount = parseInt(countRes.rows[0].cnt, 10);

    let action = 'recorded';
    if (reportCount >= AUTO_OVERRIDE_THRESHOLD) {
      action = 'auto_override';
    } else if (reportCount >= ADMIN_FLAG_THRESHOLD) {
      action = 'flagged_for_review';
    }

    res.json({
      message: 'Report submitted',
      action,
      reportCount,
    });
  } catch (err) {
    console.error('Report error:', err);
    res.status(500).json({ error: 'Failed to submit report' });
  }
});

/**
 * GET /api/reports/flagged
 * Admin: get rooms with 3+ recent reports.
 */
router.get('/flagged', authenticate, requireAdmin, async (req, res) => {
  try {
    const result = await query(`
      SELECT r.id, r.name, r.floor, sr.reported_status,
             COUNT(*) as report_count,
             MAX(sr.created_at) as latest_report
      FROM status_reports sr
      JOIN rooms r ON sr.room_id = r.id
      WHERE sr.created_at > NOW() - INTERVAL '2 hours'
      GROUP BY r.id, r.name, r.floor, sr.reported_status
      HAVING COUNT(*) >= $1
      ORDER BY report_count DESC
    `, [ADMIN_FLAG_THRESHOLD]);

    res.json({ flagged: result.rows });
  } catch (err) {
    console.error('Flagged error:', err);
    res.status(500).json({ error: 'Failed to fetch flagged rooms' });
  }
});

export default router;
