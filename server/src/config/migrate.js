import { query, getClient } from './db.js';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Database migration — creates all tables for FreeRoom.
 * Safe to run multiple times (IF NOT EXISTS).
 */
async function migrate() {
  const client = await getClient();

  try {
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
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
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

    // ── Closed days (holidays) ─────────────────────────────
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
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(building_id, name)
      );
    `);

    // ── Room aliases (for inconsistent timetable names) ────
    await client.query(`
      CREATE TABLE IF NOT EXISTS room_aliases (
        id      SERIAL PRIMARY KEY,
        alias   VARCHAR(255) UNIQUE NOT NULL,
        room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE
      );
    `);

    // ── Timetable entries (recurring weekly classes) ───────
    await client.query(`
      CREATE TABLE IF NOT EXISTS timetable_entries (
        id            SERIAL PRIMARY KEY,
        room_id       INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
        course_name   VARCHAR(255) NOT NULL,
        teacher       VARCHAR(255),
        group_name    VARCHAR(100),
        day_of_week   SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
        start_time    TIME NOT NULL,
        end_time      TIME NOT NULL,
        valid_from    DATE NOT NULL,
        valid_to      DATE NOT NULL,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CHECK (start_time < end_time),
        CHECK (valid_from <= valid_to)
      );
    `);

    // Index for fast availability queries
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_timetable_room_day
      ON timetable_entries (room_id, day_of_week);
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

    await client.query('COMMIT');
    console.log('✅ Migration completed successfully');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Migration failed:', err);
    throw err;
  } finally {
    client.release();
  }
}

// Run if called directly
const isMainModule = process.argv[1]?.includes('migrate');
if (isMainModule) {
  migrate()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

export default migrate;
