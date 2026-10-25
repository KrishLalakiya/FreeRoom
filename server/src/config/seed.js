import { getClient } from './db.js';
import migrate from './migrate.js';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Seed the database with pilot building data.
 * Matches the PRD section 5 room list.
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
    const roomC = await upsertRoom(client, buildingId, 'C', 'Ground', 60);

    // 1st floor
    const room1A = await upsertRoom(client, buildingId, '1A', '1st', 60);
    const room1B = await upsertRoom(client, buildingId, '1B', '1st', 60);

    // 2nd floor
    const room2A = await upsertRoom(client, buildingId, '2A', '2nd', 60);
    const room2C = await upsertRoom(client, buildingId, '2C', '2nd', 60);

    // 2B is dividable — create parent first, then children
    const room2B = await upsertRoom(client, buildingId, '2B', '2nd', 120);
    const room2B1 = await upsertRoom(client, buildingId, '2B1', '2nd', 60, room2B);
    const room2B2 = await upsertRoom(client, buildingId, '2B2', '2nd', 60, room2B);

    // ── Room aliases ───────────────────────────────────────
    const aliases = [
      { alias: 'C groundfloor', roomId: roomC },
      { alias: 'Classroom C', roomId: roomC },
      { alias: 'Classroom A 1st floor', roomId: room1A },
      { alias: 'Class A 1st floor', roomId: room1A },
      { alias: 'Classroom A ist floor', roomId: room1A },
      { alias: 'Block A', roomId: room1A },
      { alias: 'Classroom B 1st floor', roomId: room1B },
      { alias: 'Class B 1st floor', roomId: room1B },
      { alias: 'Block B', roomId: room1B },
      { alias: 'Class C 2nd floor', roomId: room2C },
      { alias: 'Classroom C 2nd floor', roomId: room2C },
    ];

    for (const a of aliases) {
      await client.query(`
        INSERT INTO room_aliases (alias, room_id)
        VALUES ($1, $2)
        ON CONFLICT (alias) DO UPDATE SET room_id = EXCLUDED.room_id;
      `, [a.alias, a.roomId]);
    }

    // ── Sample timetable entries ───────────────────────────
    // These simulate the Google Sheet timetable for the pilot
    const today = new Date();
    const validFrom = new Date(Date.UTC(today.getFullYear(), today.getMonth(), 1));
    const validTo = new Date(Date.UTC(today.getFullYear(), today.getMonth() + 5, 0));
    const vf = validFrom.toISOString().split('T')[0];
    const vt = validTo.toISOString().split('T')[0];

    const sampleClasses = [
      // Monday (1)
      { roomId: room1A, course: 'MERN Stack Development', teacher: 'Mrinal', group: 'Group A', day: 1, start: '10:00', end: '12:00' },
      { roomId: room1B, course: 'Data Structures', teacher: 'Sharma', group: 'Group B', day: 1, start: '10:00', end: '12:00' },
      { roomId: room2A, course: 'Operating Systems', teacher: 'Gupta', group: 'Group C', day: 1, start: '14:00', end: '16:00' },
      { roomId: room2B, course: 'Computer Networks', teacher: 'Singh', group: 'Group A', day: 1, start: '14:00', end: '16:00' },
      { roomId: roomC, course: 'Academic Clubs', teacher: null, group: null, day: 1, start: '17:30', end: '20:00' },

      // Tuesday (2)
      { roomId: room1A, course: 'FDSA', teacher: 'Kumar', group: 'Group A', day: 2, start: '09:00', end: '11:00' },
      { roomId: room2C, course: 'Database Management', teacher: 'Patel', group: 'Group B', day: 2, start: '09:00', end: '11:00' },
      { roomId: room1B, course: 'Web Technologies', teacher: 'Mehta', group: 'Group C', day: 2, start: '11:00', end: '13:00' },
      { roomId: room2B1, course: 'Machine Learning', teacher: 'Jain', group: 'Group A', day: 2, start: '14:00', end: '16:00' },
      { roomId: roomC, course: 'Academic Clubs', teacher: null, group: null, day: 2, start: '17:30', end: '20:00' },

      // Wednesday (3)
      { roomId: room1A, course: 'MERN Stack Development', teacher: 'Mrinal', group: 'Group B', day: 3, start: '10:00', end: '12:00' },
      { roomId: room2A, course: 'Cloud Computing', teacher: 'Reddy', group: 'Group A', day: 3, start: '10:00', end: '12:00' },
      { roomId: room2B2, course: 'Algorithms', teacher: 'Das', group: 'Group C', day: 3, start: '14:00', end: '16:00' },
      { roomId: roomC, course: 'Academic Clubs', teacher: null, group: null, day: 3, start: '17:30', end: '20:00' },

      // Thursday (4)
      { roomId: room1B, course: 'FDSA', teacher: 'Kumar', group: 'Group B', day: 4, start: '09:00', end: '11:00' },
      { roomId: room2C, course: 'Computer Networks', teacher: 'Singh', group: 'Group C', day: 4, start: '09:00', end: '11:00' },
      { roomId: room1A, course: 'DevOps', teacher: 'Verma', group: 'Group A', day: 4, start: '11:00', end: '13:00' },
      { roomId: room2B, course: 'Capstone Project', teacher: 'Mrinal', group: 'All', day: 4, start: '14:00', end: '17:00' },
      { roomId: roomC, course: 'Academic Clubs', teacher: null, group: null, day: 4, start: '17:30', end: '20:00' },

      // Friday (5)
      { roomId: room1A, course: 'Cloud Computing', teacher: 'Reddy', group: 'Group C', day: 5, start: '10:00', end: '12:00' },
      { roomId: room1B, course: 'Machine Learning', teacher: 'Jain', group: 'Group B', day: 5, start: '10:00', end: '12:00' },
      { roomId: room2A, course: 'MERN Stack Development', teacher: 'Mrinal', group: 'Group C', day: 5, start: '14:00', end: '16:00' },
      { roomId: roomC, course: 'Academic Clubs', teacher: null, group: null, day: 5, start: '17:30', end: '20:00' },

      // Saturday (6)
      { roomId: room1A, course: 'FDSA Repeat', teacher: 'Kumar', group: 'All', day: 6, start: '10:00', end: '12:00' },
      { roomId: room2B1, course: 'Workshop Lab A', teacher: 'Singh', group: 'Group A', day: 6, start: '10:00', end: '12:00' },
    ];

    for (const cls of sampleClasses) {
      await client.query(`
        INSERT INTO timetable_entries (room_id, course_name, teacher, group_name, day_of_week, start_time, end_time, valid_from, valid_to)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT DO NOTHING;
      `, [cls.roomId, cls.course, cls.teacher, cls.group, cls.day, cls.start, cls.end, vf, vt]);
    }

    // ── Create a dev admin user ────────────────────────────
    await client.query(`
      INSERT INTO users (email, name, role)
      VALUES ('admin@freeroom.dev', 'Dev Admin', 'admin')
      ON CONFLICT (email) DO NOTHING;
    `);

    await client.query('COMMIT');
    console.log('🌱 Seed completed successfully');
    console.log(`   Building: Pilot Building (id=${buildingId})`);
    console.log(`   Rooms: C, 1A, 1B, 2A, 2B (2B1+2B2), 2C`);
    console.log(`   Timetable entries: ${sampleClasses.length}`);
    console.log(`   Room aliases: ${aliases.length}`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Seed failed:', err);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Insert or update a room, return its id.
 */
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

// Run if called directly
const isMainModule = process.argv[1]?.includes('seed');
if (isMainModule) {
  seed()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

export default seed;
