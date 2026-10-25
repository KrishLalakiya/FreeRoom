import fs from 'fs';
import path from 'path';
import { getClient } from './db.js';
import migrate from './migrate.js';
import { importTimetable } from '../services/timetableImport.js';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Seed the database with pilot building data.
 * v2: adds batches, terms, groups, subjects, instructors (C3, C17).
 */
async function seed() {
  // Run migration first
  await migrate();

  const client = await getClient();

  try {
    await client.query('BEGIN');

    // ── Building ───────────────────────────────────────────
    const buildingRes = await client.query(`
      INSERT INTO buildings (name, opening_time, closing_time)
      VALUES ('Pilot Building', '06:00', '22:00')
      ON CONFLICT (name) DO UPDATE SET
        opening_time = EXCLUDED.opening_time,
        closing_time = EXCLUDED.closing_time
      RETURNING id;
    `);
    const buildingId = buildingRes.rows[0].id;

    // ── Rooms ──────────────────────────────────────────────
    // Ground floor
    const roomC = await upsertRoom(client, buildingId, 'C', 'Ground', 200);

    // 1st floor
    const room1A = await upsertRoom(client, buildingId, '1A', '1st', 200);
    const room1B = await upsertRoom(client, buildingId, '1B', '1st', 200);

    // 2nd floor
    const room2A = await upsertRoom(client, buildingId, '2A', '2nd', 200);
    const room2C = await upsertRoom(client, buildingId, '2C', '2nd', 200);

    // 2B is dividable — create parent first, then children
    const room2B = await upsertRoom(client, buildingId, '2B', '2nd', 200);
    const room2B1 = await upsertRoom(client, buildingId, '2B1', '2nd', 100, room2B);
    const room2B2 = await upsertRoom(client, buildingId, '2B2', '2nd', 100, room2B);

    // ── Room aliases ───────────────────────────────────────
    const aliases = [
      { alias: 'C groundfloor', roomId: roomC },
      { alias: 'Classroom C', roomId: roomC },
      { alias: 'Class C Ground floor', roomId: roomC },
      { alias: 'Class C ground floor', roomId: roomC },
      { alias: 'Classroom A 1st floor', roomId: room1A },
      { alias: 'Class A 1st floor', roomId: room1A },
      { alias: 'Classroom A ist floor', roomId: room1A },
      { alias: 'Block A', roomId: room1A },
      { alias: 'Classroom B 1st floor', roomId: room1B },
      { alias: 'Class B 1st floor', roomId: room1B },
      { alias: 'Block B', roomId: room1B },
      { alias: 'Class A 2nd floor', roomId: room2A },
      { alias: 'Classroom A 2nd floor', roomId: room2A },
      { alias: 'Classroom A, 2nd Floor', roomId: room2A },
      { alias: 'Class C 2nd floor', roomId: room2C },
      { alias: 'Classroom C 2nd floor', roomId: room2C },
      { alias: 'Classroom C, 2nd Floor', roomId: room2C },
    ];

    for (const a of aliases) {
      await client.query(`
        INSERT INTO room_aliases (alias, room_id)
        VALUES ($1, $2)
        ON CONFLICT (alias) DO UPDATE SET room_id = EXCLUDED.room_id;
      `, [a.alias, a.roomId]);
    }

    // ── Batches (C3) ──────────────────────────────────────
    const batch2029 = await upsertBatch(client, 2029);
    const batch2028 = await upsertBatch(client, 2028);

    // ── Terms (C3) ────────────────────────────────────────
    const term5 = await upsertTerm(client, batch2029, 3, 5, '2026-08-01', '2026-10-28');
    const term9 = await upsertTerm(client, batch2028, 5, 9, '2026-08-01', '2026-10-28');

    // ── Groups (C17) ──────────────────────────────────────
    const grpA_2029 = await upsertGroup(client, batch2029, 'A');
    const grpB_2029 = await upsertGroup(client, batch2029, 'B');
    const grpC_2029 = await upsertGroup(client, batch2029, 'C');
    const grpA_2028 = await upsertGroup(client, batch2028, 'A');
    const grpB_2028 = await upsertGroup(client, batch2028, 'B');

    // ── Subjects (C17) ────────────────────────────────────
    const subMERN = await upsertSubject(client, 'MERN Stack Development', 'MERN');
    const subDS = await upsertSubject(client, 'Data Structures', 'DS');
    const subOS = await upsertSubject(client, 'Operating Systems', 'OS');
    const subCN = await upsertSubject(client, 'Computer Networks', 'CN');
    const subFDSA = await upsertSubject(client, 'FDSA', 'FDSA');
    const subDB = await upsertSubject(client, 'Database Management', 'DB');
    const subWeb = await upsertSubject(client, 'Web Technologies', 'WEB');
    const subML = await upsertSubject(client, 'Machine Learning', 'ML');
    const subCloud = await upsertSubject(client, 'Cloud Computing', 'CLOUD');
    const subAlgo = await upsertSubject(client, 'Algorithms', 'ALGO');
    const subDevOps = await upsertSubject(client, 'DevOps', 'DEVOPS');
    const subCapstone = await upsertSubject(client, 'Capstone Project', 'CAP');
    const subFDSAR = await upsertSubject(client, 'FDSA Repeat', 'FDSAR');
    const subClubs = await upsertSubject(client, 'Academic Clubs', 'CLUBS');
    const subWorkshop = await upsertSubject(client, 'Workshop Lab A', 'WKSHP');

    // ── Instructors (C17) ─────────────────────────────────
    const instMrinal = await upsertInstructor(client, 'Mrinal');
    const instSharma = await upsertInstructor(client, 'Sharma');
    const instGupta = await upsertInstructor(client, 'Gupta');
    const instSingh = await upsertInstructor(client, 'Singh');
    const instKumar = await upsertInstructor(client, 'Kumar');
    const instPatel = await upsertInstructor(client, 'Patel');
    const instMehta = await upsertInstructor(client, 'Mehta');
    const instJain = await upsertInstructor(client, 'Jain');
    const instReddy = await upsertInstructor(client, 'Reddy');
    const instDas = await upsertInstructor(client, 'Das');
    const instVerma = await upsertInstructor(client, 'Verma');

    // ── Clear timetable entries (v1 hardcoded entries) ────
    await client.query('DELETE FROM timetable_entries;');

    // ── Create a dev admin user ────────────────────────────
    await client.query(`
      INSERT INTO users (email, name, role)
      VALUES ('admin@freeroom.dev', 'Dev Admin', 'admin')
      ON CONFLICT (email) DO NOTHING;
    `);

    await client.query('COMMIT');
    console.log('🌱 Base seed completed successfully (rooms, batches, terms, aliases)');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Seed failed during base setup:', err);
    throw err;
  } finally {
    client.release();
  }

  // ── Import real timetable sheets (C4, C18) ───────────────
  const findExcelFile = (filename) => {
    const candidates = [
      path.resolve(process.cwd(), '..', filename),
      path.resolve(process.cwd(), filename),
      path.resolve(import.meta.dirname, '../../../', filename),
      path.resolve(import.meta.dirname, '../../..', filename),
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) return p;
    }
    throw new Error(`Could not find Excel file "${filename}"`);
  };

  const file2029 = findExcelFile('SST 2029 Batch Term 5 Syllabus.xlsx');
  const file2028 = findExcelFile('SST 2028 Batch Term 9 Syllabus.xlsx');

  console.log(`📥 Importing 2029 Term 5 from ${file2029}...`);
  const res2029 = await importTimetable(file2029, { batchYear: 2029, termNumber: 5 });
  console.log(`   2029 T5: parsed=${res2029.parsedCount}, saved=${res2029.savedCount}, duplicates=${res2029.duplicateCount}, unmapped=${res2029.unmappedRooms.length}, errors=${res2029.errors.length}`);
  if (res2029.errors.length > 0) {
    console.warn('   Errors in 2029 T5:', res2029.errors);
  }

  console.log(`📥 Importing 2028 Term 9 from ${file2028}...`);
  const res2028 = await importTimetable(file2028, { batchYear: 2028, termNumber: 9 });
  console.log(`   2028 T9: parsed=${res2028.parsedCount}, saved=${res2028.savedCount}, duplicates=${res2028.duplicateCount}, unmapped=${res2028.unmappedRooms.length}, errors=${res2028.errors.length}`);
  if (res2028.errors.length > 0) {
    console.warn('   Errors in 2028 T9:', res2028.errors);
  }

  // Verify in DB
  const verifyClient = await getClient();
  try {
    const countRes = await verifyClient.query(`
      SELECT
        COUNT(*) AS total_entries,
        COUNT(CASE WHEN term_id IS NULL THEN 1 END) AS missing_term,
        COUNT(CASE WHEN subject_id IS NULL THEN 1 END) AS missing_subject
      FROM timetable_entries;
    `);
    const groupCountRes = await verifyClient.query(`
      SELECT COUNT(*) AS total_group_links FROM timetable_entry_groups;
    `);
    const stats = countRes.rows[0];
    const groupStats = groupCountRes.rows[0];
    console.log(`✅ DB verification:`);
    console.log(`   Total entries: ${stats.total_entries}`);
    console.log(`   Missing term_id: ${stats.missing_term}`);
    console.log(`   Missing subject_id: ${stats.missing_subject}`);
    console.log(`   Total group links: ${groupStats.total_group_links}`);
  } finally {
    verifyClient.release();
  }
}

// ── Helper functions ──────────────────────────────────────

async function upsertRoom(client, buildingId, name, floor, capacity, parentRoomId = null) {
  const res = await client.query(`
    INSERT INTO rooms (building_id, name, floor, capacity, parent_room_id)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (building_id, name) DO UPDATE SET
      floor = EXCLUDED.floor,
      capacity = EXCLUDED.capacity,
      parent_room_id = EXCLUDED.parent_room_id
    RETURNING id;
  `, [buildingId, name, floor, capacity, parentRoomId]);
  return res.rows[0].id;
}

async function upsertBatch(client, year) {
  const res = await client.query(`
    INSERT INTO batches (year) VALUES ($1)
    ON CONFLICT (year) DO UPDATE SET year = EXCLUDED.year
    RETURNING id;
  `, [year]);
  return res.rows[0].id;
}

async function upsertTerm(client, batchId, semesterNumber, termNumber, startDate, endDate) {
  const res = await client.query(`
    INSERT INTO terms (batch_id, semester_number, term_number, start_date, end_date)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (batch_id, term_number) DO UPDATE SET
      semester_number = EXCLUDED.semester_number,
      start_date = EXCLUDED.start_date,
      end_date = EXCLUDED.end_date
    RETURNING id;
  `, [batchId, semesterNumber, termNumber, startDate, endDate]);
  return res.rows[0].id;
}

async function upsertGroup(client, batchId, name) {
  const res = await client.query(`
    INSERT INTO groups (batch_id, name) VALUES ($1, $2)
    ON CONFLICT (batch_id, name) DO UPDATE SET name = EXCLUDED.name
    RETURNING id;
  `, [batchId, name]);
  return res.rows[0].id;
}

async function upsertSubject(client, name, shortCode = null) {
  const res = await client.query(`
    INSERT INTO subjects (name, short_code) VALUES ($1, $2)
    ON CONFLICT (name) DO UPDATE SET short_code = COALESCE(EXCLUDED.short_code, subjects.short_code)
    RETURNING id;
  `, [name, shortCode]);
  return res.rows[0].id;
}

async function upsertInstructor(client, name) {
  const res = await client.query(`
    INSERT INTO instructors (name) VALUES ($1)
    ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
    RETURNING id;
  `, [name]);
  return res.rows[0].id;
}

async function getSubjectName(client, subjectId) {
  const res = await client.query('SELECT name FROM subjects WHERE id = $1', [subjectId]);
  return res.rows[0]?.name || null;
}

async function getInstructorName(client, instructorId) {
  const res = await client.query('SELECT name FROM instructors WHERE id = $1', [instructorId]);
  return res.rows[0]?.name || null;
}

async function getGroupName(client, groupId) {
  const res = await client.query('SELECT name FROM groups WHERE id = $1', [groupId]);
  return res.rows[0]?.name || null;
}

// Run if called directly
const isMainModule = process.argv[1]?.includes('seed');
if (isMainModule) {
  seed()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('❌ Top-level seed error:', err);
      process.exit(1);
    });
}

export default seed;
