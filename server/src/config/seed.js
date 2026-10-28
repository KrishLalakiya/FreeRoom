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
    const roomSSB = await upsertRoom(client, buildingId, 'SSB', 'Ground', 200);

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
      { alias: 'Claas A 2nd floor', roomId: room2A },
      { alias: 'Classroom A 2nd floor', roomId: room2A },
      { alias: 'Classroom A, 2nd Floor', roomId: room2A },
      { alias: 'Class B 2nd floor', roomId: room2B },
      { alias: 'Classroom B 2nd floor', roomId: room2B },
      { alias: 'Class B, 2nd Floor', roomId: room2B },
      { alias: 'Classroom B, 2nd Floor', roomId: room2B },
      { alias: 'Classroom B1+B2 2nd Floor', roomId: room2B },
      { alias: 'Classroom B1+B2 2nd floor', roomId: room2B },
      { alias: 'Classroom B1+B2', roomId: room2B },
      { alias: 'Class B1+B2 2nd floor', roomId: room2B },
      { alias: 'Class B1+B2 2nd Floor', roomId: room2B },
      { alias: 'B1+B2 2nd floor', roomId: room2B },
      { alias: 'Class B1 2nd floor', roomId: room2B1 },
      { alias: 'Classroom B1 2nd floor', roomId: room2B1 },
      { alias: 'Class B2 2nd floor', roomId: room2B2 },
      { alias: 'Classroom B2 2nd floor', roomId: room2B2 },
      { alias: 'Class C 2nd floor', roomId: room2C },
      { alias: 'Classroom C 2nd floor', roomId: room2C },
      { alias: 'Classroom C, 2nd Floor', roomId: room2C },
      { alias: 'SSB Classroom', roomId: roomSSB },
      { alias: 'ssb', roomId: roomSSB },
    ];

    for (const a of aliases) {
      await client.query(`
        INSERT INTO room_aliases (alias, room_id)
        VALUES ($1, $2)
        ON CONFLICT (alias) DO UPDATE SET room_id = EXCLUDED.room_id;
      `, [a.alias, a.roomId]);
    }

    // ── Batches (C3) ──────────────────────────────────────
    const batch2027 = await upsertBatch(client, 2027);
    const batch2028 = await upsertBatch(client, 2028);
    const batch2029 = await upsertBatch(client, 2029);
    const batch2030 = await upsertBatch(client, 2030);

    // ── Terms per Academic Calendar (PRD v7) ──────────────
    // Term I (Aug to 24 Oct 2026)
    const term13 = await upsertTerm(client, batch2027, 7, 13, '2026-08-01', '2026-10-24');
    const term5 = await upsertTerm(client, batch2029, 3, 5, '2026-08-01', '2026-10-24');
    const term9 = await upsertTerm(client, batch2028, 5, 9, '2026-08-01', '2026-10-24');
    const term1_2030 = await upsertTerm(client, batch2030, 1, 1, '2026-08-06', '2026-10-24');

    // Term II (29 Oct 2026 to 31 Jan 2027) - Urgent PRD v7
    const term14 = await upsertTerm(client, batch2027, 7, 14, '2026-10-29', '2027-01-31');
    const term6 = await upsertTerm(client, batch2029, 3, 6, '2026-10-29', '2027-01-31');
    const term10 = await upsertTerm(client, batch2028, 5, 10, '2026-10-29', '2027-01-31');
    const term2_2030 = await upsertTerm(client, batch2030, 1, 2, '2026-10-29', '2027-01-31');

    // ── Groups (C17) ──────────────────────────────────────
    const grpA_2027 = await upsertGroup(client, batch2027, 'A');
    const grpA_2029 = await upsertGroup(client, batch2029, 'A');
    const grpB_2029 = await upsertGroup(client, batch2029, 'B');
    const grpC_2029 = await upsertGroup(client, batch2029, 'C');
    const grpA_2028 = await upsertGroup(client, batch2028, 'A');
    const grpB_2028 = await upsertGroup(client, batch2028, 'B');
    const grpA_2030 = await upsertGroup(client, batch2030, 'A');
    const grpB_2030 = await upsertGroup(client, batch2030, 'B');
    const grpC_2030 = await upsertGroup(client, batch2030, 'C');
    const grpD_2030 = await upsertGroup(client, batch2030, 'D');

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

    // ── Closures (PRD v7 Section 3) ────────────────────────
    const closuresToSeed = [
      { start: '2026-10-19', end: '2026-10-24', reason: 'End-term I Exams' },
      { start: '2027-01-20', end: '2027-01-25', reason: 'End-term II Exams (Tentative)' },
      { start: '2027-03-04', end: '2027-03-07', reason: 'Mid-term III Exams (Batch 2030)' },
      { start: '2027-04-08', end: '2027-04-13', reason: 'End-term III Exams (Tentative)' },
      { start: '2027-05-20', end: '2027-05-23', reason: 'Mid-term IV Exams (Batch 2030)' },
      { start: '2027-06-25', end: '2027-06-30', reason: 'End-term IV Exams (Tentative)' },
    ];
    for (const c of closuresToSeed) {
      await client.query(`
        INSERT INTO closures (building_id, scope, start_date, end_date, reason)
        VALUES ($1, 'everyone', $2, $3, $4)
        ON CONFLICT DO NOTHING;
      `, [buildingId, c.start, c.end, c.reason]);
    }

    // ── No-Class Days (PRD v7 Section 3) ───────────────────
    const holidays = [
      // Diwali break
      '2026-11-06', '2026-11-07', '2026-11-08', '2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12',
      // Winter break
      '2026-12-25', '2026-12-26', '2026-12-27', '2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31',
      '2027-01-01', '2027-01-02', '2027-01-03',
      // Holidays
      '2026-10-02', '2026-10-21', '2026-10-25',
      '2026-11-01', '2026-11-24',
      '2027-01-15', '2027-01-26',
      '2027-03-10', '2027-03-22', '2027-03-26',
      '2027-04-07', '2027-04-14', '2027-04-19',
      '2027-05-01', '2027-05-09', '2027-05-17',
      '2027-06-15',
    ];
    for (const h of holidays) {
      await client.query(`
        INSERT INTO no_class_days (building_id, date, reason)
        VALUES ($1, $2, 'Academic Calendar Holiday')
        ON CONFLICT (building_id, date) DO NOTHING;
      `, [buildingId, h]);
    }

    // ── Clear timetable entries (v1 hardcoded entries) ────
    const entryCheck = await client.query('SELECT COUNT(*) as cnt FROM timetable_entries;');
    const hasEntries = parseInt(entryCheck.rows[0].cnt, 10) > 0;
    if (process.env.FORCE_SEED === 'true' || !hasEntries) {
      await client.query('DELETE FROM timetable_entries;');
    }

    // ── Create a dev admin user (Development only per PRD v7 Section 5 Item 4) ──
    if (process.env.NODE_ENV !== 'production') {
      await client.query(`
        INSERT INTO users (email, name, role)
        VALUES ('admin@freeroom.dev', 'Dev Admin', 'admin')
        ON CONFLICT (email) DO NOTHING;
      `);
    }

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
      path.resolve(process.cwd(), 'server/data', filename),
      path.resolve(process.cwd(), 'data', filename),
      path.resolve(__dirname, '../data', filename),
      path.resolve(__dirname, '../../data', filename),
      path.resolve(process.cwd(), '..', filename),
      path.resolve(process.cwd(), filename),
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) return p;
    }
    return null;
  };

  const timetableJobs = [
    { file: 'SST 2029 Batch Term 5 Syllabus.xlsx', batch: 2029, term: 5 },
    { file: 'SST 2028 Batch Term 9 Syllabus.xlsx', batch: 2028, term: 9 },
    { file: 'SST 2029 Batch Term 6 Syllabus.xlsx', batch: 2029, term: 6 },
    { file: 'SST 2028 Batch Term 10 Syllabus.xlsx', batch: 2028, term: 10 },
    { file: 'SST 2030 Batch Term 1  Syllabus.xlsx', batch: 2030, term: 1 },
    { file: 'SST 2030 Batch Term 2 Syllabus.xlsx', batch: 2030, term: 2 },
  ];

  for (const job of timetableJobs) {
    const filePath = findExcelFile(job.file);
    if (!filePath) {
      console.warn(`⚠️ Skipping ${job.file}: file not found`);
      continue;
    }
    console.log(`📥 Importing Batch ${job.batch} Term ${job.term} from ${filePath}...`);
    try {
      const res = await importTimetable(filePath, { batchYear: job.batch, termNumber: job.term });
      console.log(`   Batch ${job.batch} T${job.term}: parsed=${res.parsedCount}, saved=${res.savedCount}, duplicates=${res.duplicateCount}, unmapped=${res.unmappedRooms.length}, errors=${res.errors.length}`);
      if (res.errors.length > 0) {
        console.warn(`   Errors in Batch ${job.batch} T${job.term}:`, res.errors);
      }
    } catch (err) {
      console.error(`   Failed to import ${job.file}:`, err.message);
    }
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
