import { getClient } from './db.js';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Database migration — creates all tables for FreeRoom.
 * Safe to run multiple times (IF NOT EXISTS).
 */
async function migrate() {
  if (!process.env.DATABASE_URL) {
    console.warn('⚠️ DATABASE_URL environment variable is not set. Skipping migration.');
    return;
  }

  let client;
  try {
    client = await getClient();
    await client.query('BEGIN');

    // ── Users ──────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id            SERIAL PRIMARY KEY,
        email         VARCHAR(255) UNIQUE NOT NULL,
        name          VARCHAR(255),
        google_id     VARCHAR(255) UNIQUE,
        avatar_url    TEXT,
        role          VARCHAR(20) NOT NULL DEFAULT 'student'
                        CHECK (role IN ('student', 'admin')),
        settings      JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // Ensure settings column exists if table was created previously
    await client.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS settings JSONB NOT NULL DEFAULT '{}'::jsonb;
    `);

    // ── Buildings ──────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS buildings (
        id              SERIAL PRIMARY KEY,
        name            VARCHAR(255) UNIQUE NOT NULL,
        opening_time    TIME NOT NULL DEFAULT '06:00',
        closing_time    TIME NOT NULL DEFAULT '22:00',
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // ── Closed days (legacy — C2 removed the holiday rule; C6 will replace with closures) ──
    await client.query(`
      CREATE TABLE IF NOT EXISTS closed_days (
        id          SERIAL PRIMARY KEY,
        building_id INTEGER NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
        date        DATE NOT NULL,
        reason      VARCHAR(255),
        UNIQUE(building_id, date)
      );
    `);

    // ── Rooms ──────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS rooms (
        id              SERIAL PRIMARY KEY,
        building_id     INTEGER NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
        name            VARCHAR(100) NOT NULL,
        floor           VARCHAR(50),
        capacity        INTEGER,
        parent_room_id  INTEGER REFERENCES rooms(id) ON DELETE SET NULL,
        is_study_allowed BOOLEAN NOT NULL DEFAULT TRUE,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(building_id, name)
      );
    `);

    await client.query(`
      ALTER TABLE rooms
      ADD COLUMN IF NOT EXISTS is_study_allowed BOOLEAN NOT NULL DEFAULT TRUE;
    `);

    await client.query(`
      UPDATE rooms
      SET is_study_allowed = FALSE
      WHERE UPPER(name) = 'SSB';
    `);

    // ── Room aliases (for inconsistent timetable names) ────
    await client.query(`
      CREATE TABLE IF NOT EXISTS room_aliases (
        id      SERIAL PRIMARY KEY,
        alias   VARCHAR(255) UNIQUE NOT NULL,
        room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE
      );
    `);

    // ── Batches (C3, C17) ─────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS batches (
        id          SERIAL PRIMARY KEY,
        year        INTEGER UNIQUE NOT NULL,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // ── Terms (C3) ────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS terms (
        id              SERIAL PRIMARY KEY,
        batch_id        INTEGER NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
        semester_number SMALLINT NOT NULL,
        term_number     SMALLINT NOT NULL,
        start_date      DATE NOT NULL,
        end_date        DATE NOT NULL,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CHECK (start_date <= end_date),
        UNIQUE(batch_id, term_number)
      );
    `);

    // ── Subjects (C17) ───────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS subjects (
        id          SERIAL PRIMARY KEY,
        name        VARCHAR(255) NOT NULL,
        short_code  VARCHAR(100),
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(name)
      );
    `);

    // ── Instructors (C17) ─────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS instructors (
        id          SERIAL PRIMARY KEY,
        name        VARCHAR(255) NOT NULL,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(name)
      );
    `);

    // ── Groups (C17) ──────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS groups (
        id          SERIAL PRIMARY KEY,
        batch_id    INTEGER NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
        name        VARCHAR(100) NOT NULL,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(batch_id, name)
      );
    `);

    // ── Timetable entries (recurring weekly classes) ───────
    // v2 adds term_id, subject_id, instructor_id, entry_type (C3, C17).
    // Old columns (course_name, teacher, group_name, valid_from, valid_to) are
    // kept for backward compatibility but superseded by linked records.
    await client.query(`
      CREATE TABLE IF NOT EXISTS timetable_entries (
        id              SERIAL PRIMARY KEY,
        room_id         INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
        term_id         INTEGER REFERENCES terms(id) ON DELETE CASCADE,
        subject_id      INTEGER REFERENCES subjects(id) ON DELETE SET NULL,
        instructor_id   INTEGER REFERENCES instructors(id) ON DELETE SET NULL,
        entry_type      VARCHAR(20) NOT NULL DEFAULT 'class'
                          CHECK (entry_type IN ('class', 'lab', 'club')),
        day_of_week     SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
        start_time      TIME NOT NULL,
        end_time        TIME NOT NULL,
        -- Legacy columns kept for migration; new imports use term_id instead
        course_name     VARCHAR(255),
        teacher         VARCHAR(255),
        group_name      VARCHAR(100),
        valid_from      DATE,
        valid_to        DATE,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CHECK (start_time < end_time)
      );
    `);

    // ── Schema migrations tracking (PRD v7 Section 5 Item 10) ──
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version     VARCHAR(255) PRIMARY KEY,
        applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // v2 columns added via ALTER for existing databases (PRD v7 Section 5 Item 9: no silent catches)
    const v2AlterQueries = [
      "ALTER TABLE timetable_entries ADD COLUMN IF NOT EXISTS term_id INTEGER REFERENCES terms(id) ON DELETE CASCADE",
      "ALTER TABLE timetable_entries ADD COLUMN IF NOT EXISTS subject_id INTEGER REFERENCES subjects(id) ON DELETE SET NULL",
      "ALTER TABLE timetable_entries ADD COLUMN IF NOT EXISTS instructor_id INTEGER REFERENCES instructors(id) ON DELETE SET NULL",
      "ALTER TABLE timetable_entries ADD COLUMN IF NOT EXISTS entry_type VARCHAR(20) NOT NULL DEFAULT 'class'",
      "ALTER TABLE timetable_entries ADD COLUMN IF NOT EXISTS raw_cell TEXT",
      "ALTER TABLE timetable_entries ADD COLUMN IF NOT EXISTS sheet_name VARCHAR(255)",
      "ALTER TABLE timetable_entries ADD COLUMN IF NOT EXISTS sheet_row INTEGER",
      "ALTER TABLE timetable_entries ADD COLUMN IF NOT EXISTS sheet_col INTEGER",
      "ALTER TABLE timetable_entries ADD COLUMN IF NOT EXISTS source_file VARCHAR(255)",
    ];
    for (const q of v2AlterQueries) {
      await client.query(q);
    }

    // ── Timetable entry ↔ groups junction (C17) ──────────
    // A class can belong to zero, one or several groups.
    await client.query(`
      CREATE TABLE IF NOT EXISTS timetable_entry_groups (
        timetable_entry_id  INTEGER NOT NULL REFERENCES timetable_entries(id) ON DELETE CASCADE,
        group_id            INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
        PRIMARY KEY (timetable_entry_id, group_id)
      );
    `);

    // Index for fast availability queries
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_timetable_room_day
      ON timetable_entries (room_id, day_of_week);
    `);

    // Index for term-based lookups
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_timetable_term
      ON timetable_entries (term_id);
    `);

    // ── Schedule exceptions (cancellations) ────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS schedule_exceptions (
        id                  SERIAL PRIMARY KEY,
        timetable_entry_id  INTEGER NOT NULL REFERENCES timetable_entries(id) ON DELETE CASCADE,
        date                DATE NOT NULL,
        reason              VARCHAR(255),
        created_by          INTEGER REFERENCES users(id),
        created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(timetable_entry_id, date)
      );
    `);

    // ── Events (one-off: exams, seminars, clubs) ───────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS events (
        id          SERIAL PRIMARY KEY,
        room_id     INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
        title       VARCHAR(255) NOT NULL,
        start_at    TIMESTAMPTZ NOT NULL,
        end_at      TIMESTAMPTZ NOT NULL,
        created_by  INTEGER REFERENCES users(id),
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CHECK (start_at < end_at)
      );
    `);

    // Index for fast event lookups
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_events_room_start
      ON events (room_id, start_at);
    `);

    // ── Status reports (student feedback) ──────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS status_reports (
        id              SERIAL PRIMARY KEY,
        room_id         INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
        user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        reported_status VARCHAR(20) NOT NULL
                          CHECK (reported_status IN ('not_empty', 'actually_free')),
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // Index for dedup check
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_status_reports_room_user
      ON status_reports (room_id, user_id, created_at);
    `);

    // ── Saved rooms (P2 - favorites) ───────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS saved_rooms (
        user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        room_id   INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
        PRIMARY KEY (user_id, room_id)
      );
    `);

    // ── Closures (C6: room, floor, or building closures/exams) ──
    await client.query(`
      CREATE TABLE IF NOT EXISTS closures (
        id          SERIAL PRIMARY KEY,
        scope       VARCHAR(20) NOT NULL CHECK (scope IN ('room', 'floor', 'building')),
        building_id INTEGER REFERENCES buildings(id) ON DELETE CASCADE,
        room_id     INTEGER REFERENCES rooms(id) ON DELETE CASCADE,
        floor       VARCHAR(50),
        start_date  DATE NOT NULL,
        end_date    DATE NOT NULL,
        start_time  TIME,
        end_time    TIME,
        reason      VARCHAR(255) NOT NULL DEFAULT 'Exam',
        note        TEXT,
        created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CHECK (start_date <= end_date),
        CHECK (
          (start_time IS NULL AND end_time IS NULL) OR
          (start_time IS NOT NULL AND end_time IS NOT NULL AND start_time < end_time)
        ),
        CHECK (scope != 'room' OR room_id IS NOT NULL),
        CHECK (scope != 'floor' OR floor IS NOT NULL)
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_closures_dates
      ON closures (start_date, end_date);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_closures_scope_room
      ON closures (scope, room_id);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_closures_scope_floor
      ON closures (scope, floor);
    `);

    // ── No-class days (C12: holidays and breaks where classes do not run) ──
    await client.query(`
      CREATE TABLE IF NOT EXISTS no_class_days (
        id          SERIAL PRIMARY KEY,
        building_id INTEGER REFERENCES buildings(id) ON DELETE CASCADE,
        date        DATE NOT NULL,
        reason      VARCHAR(255) NOT NULL DEFAULT 'Holiday',
        created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(building_id, date)
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_no_class_days_date
      ON no_class_days (date);
    `);

    // ── Admin action log (PRD v5: logs every admin action with name and time) ──
    await client.query(`
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

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_admin_actions_created_at
      ON admin_actions (created_at DESC);
    `);

    // ── System settings (PRD v8: X minimum free minutes, buffer, chain enabled) ──
    await client.query(`
      CREATE TABLE IF NOT EXISTS system_settings (
        key         VARCHAR(100) PRIMARY KEY,
        value       JSONB NOT NULL,
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await client.query('COMMIT');
    console.log('✅ Migration completed successfully');
  } catch (err) {
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch (rbErr) {
        // Ignore rollback error
      }
    }
    console.error('❌ Migration failed:', err.message || err);
    throw err;
  } finally {
    if (client) {
      client.release();
    }
  }
}

// Run if called directly
const isMainModule = process.argv[1]?.includes('migrate');
if (isMainModule) {
  migrate()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Migration execution failed:', err.message || err);
      process.exit(1);
    });
}

export default migrate;
