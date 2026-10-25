import XLSX from 'xlsx';
import { getClient } from '../config/db.js';

const DAY_NAMES = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

const IGNORED_SHEET = /syllabus|exam|weightage|marks|grade/i;
const IGNORED_CELL = /^(lunch|break|recess|interval)$/i;
const DEFAULT_START_MINUTES = 9 * 60;
const DEFAULT_STEP_MINUTES = 15;

export function normalizeRoomKey(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function isIgnoredCell(value) {
  if (value === null || value === undefined) return true;
  return IGNORED_CELL.test(String(value).replace(/\s+/g, ' ').trim());
}

/**
 * Convert an Excel time cell (serial fraction, Date or text) to minutes past midnight.
 */
export function parseTimeToMinutes(value) {
  if (value === null || value === undefined || value === '') return null;

  if (value instanceof Date) {
    return value.getHours() * 60 + value.getMinutes();
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    const fraction = value - Math.floor(value);
    const minutes = Math.round(fraction * 24 * 60);
    if (minutes < 0 || minutes >= 24 * 60) return null;
    return minutes;
  }

  const text = String(value).trim();
  if (!text) return null;

  const twelveHour = text.match(/^(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)$/i);
  if (twelveHour) {
    let hours = parseInt(twelveHour[1], 10);
    const minutes = twelveHour[2] ? parseInt(twelveHour[2], 10) : 0;
    const meridiem = twelveHour[3].toLowerCase();
    if (hours < 1 || hours > 12 || minutes > 59) return null;
    if (meridiem === 'pm' && hours !== 12) hours += 12;
    if (meridiem === 'am' && hours === 12) hours = 0;
    return hours * 60 + minutes;
  }

  const twentyFourHour = text.match(/^(\d{1,2})[:.](\d{2})(?::\d{2})?$/);
  if (twentyFourHour) {
    const hours = parseInt(twentyFourHour[1], 10);
    const minutes = parseInt(twentyFourHour[2], 10);
    if (hours > 23 || minutes > 59) return null;
    return hours * 60 + minutes;
  }

  return null;
}

export function minutesToTime(minutes) {
  const normalized = ((minutes % (24 * 60)) + 24 * 60) % (24 * 60);
  const hours = Math.floor(normalized / 60);
  const mins = normalized % 60;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

/**
 * Parse a class cell such as
 * "MERN - 2029, Grp A, (Mrinal), Classroom A 1st floor".
 * Returns null when the text is not usable.
 */
export function parseClassCell(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'string') return null;

  const text = raw.replace(/\s+/g, ' ').trim();
  if (!text || isIgnoredCell(text)) return null;

  let teacher = null;
  const teacherMatch = text.match(/\(([^)]*)\)/);
  if (teacherMatch) {
    teacher = teacherMatch[1].trim() || null;
  }

  let rest = text.replace(/\([^)]*\)/g, ' ');

  let group = null;
  const groupMatch = rest.match(/\b(?:group|grp)\.?\s*[:\-]?\s*([a-z0-9]+)\b/i);
  if (groupMatch) {
    group = groupMatch[1].toUpperCase();
    rest = rest.replace(groupMatch[0], ' ');
  }

  const parts = rest
    .split(',')
    .map((part) => part.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  if (parts.length === 0) return null;

  let roomName = null;
  if (parts.length >= 2) {
    roomName = parts.pop();
  }

  const course = parts
    .join(', ')
    .replace(/[\s,;:-]+$/, '')
    .trim();

  if (!course && !roomName) return null;

  return {
    course: course || text,
    group,
    teacher,
    roomName,
  };
}

function buildGrid(sheet) {
  const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1');
  const rows = range.e.r + 1;
  const cols = range.e.c + 1;

  const grid = Array.from({ length: rows }, () => Array(cols).fill(null));
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })];
      if (cell && cell.v !== undefined && cell.v !== null && cell.v !== '') {
        grid[r][c] = cell.v;
      }
    }
  }

  const merges = (sheet['!merges'] || []).map((m) => ({
    r1: m.s.r,
    c1: m.s.c,
    r2: m.e.r,
    c2: m.e.c,
  }));

  const anchorAt = new Map();
  const covered = new Set();

  for (const merge of merges) {
    anchorAt.set(`${merge.r1},${merge.c1}`, merge);
    for (let r = merge.r1; r <= merge.r2; r += 1) {
      for (let c = merge.c1; c <= merge.c2; c += 1) {
        if (r === merge.r1 && c === merge.c1) continue;
        covered.add(`${r},${c}`);
      }
    }
  }

  return { grid, rows, cols, merges, anchorAt, covered };
}

function findDayHeader(grid, rows, cols, fromRow, toRow, colStart = 0, colEnd = cols - 1) {
  let best = null;

  for (let r = fromRow; r <= toRow; r += 1) {
    const columns = {};
    for (let c = colStart; c <= colEnd; c += 1) {
      const value = grid[r][c];
      if (typeof value !== 'string') continue;
      const key = value.replace(/\s+/g, ' ').trim().toLowerCase();
      if (DAY_NAMES[key] !== undefined) {
        columns[DAY_NAMES[key]] = c;
      }
    }
    const count = Object.keys(columns).length;
    if (count >= 3 && (!best || count > best.count)) {
      best = { row: r, columns, count };
    }
  }

  return best;
}

function makeTimeResolver(grid, rows, cols, fromRow, toRow, dayColumns, colStart = 0, colEnd = cols - 1) {
  const labels = new Map();
  const dayColumnSet = new Set(Object.values(dayColumns));

  for (let r = fromRow; r <= toRow; r += 1) {
    for (let c = colStart; c <= colEnd; c += 1) {
      if (dayColumnSet.has(c)) continue;
      const minutes = parseTimeToMinutes(grid[r][c]);
      if (minutes !== null) {
        labels.set(r, minutes);
        break;
      }
    }
  }

  const anchors = [...labels.entries()].sort((a, b) => a[0] - b[0]);

  let step = DEFAULT_STEP_MINUTES;
  if (anchors.length >= 2) {
    for (let i = 1; i < anchors.length; i += 1) {
      const delta = anchors[i][0] - anchors[i - 1][0];
      const minuteDelta = anchors[i][1] - anchors[i - 1][1];
      if (delta > 0 && minuteDelta > 0) {
        step = Math.round(minuteDelta / delta);
        break;
      }
    }
  }

  const firstDataRow = fromRow;

  return {
    step,
    resolve(row) {
      if (labels.has(row)) return labels.get(row);

      let before = null;
      let after = null;
      for (const anchor of anchors) {
        if (anchor[0] <= row) before = anchor;
        else {
          after = anchor;
          break;
        }
      }

      if (before) return before[1] + (row - before[0]) * step;
      if (after) return after[1] - (after[0] - row) * step;
      return DEFAULT_START_MINUTES + (row - firstDataRow) * step;
    },
  };
}

function findGroupHeaders(grid, rows, cols) {
  const headers = [];
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const value = grid[r][c];
      if (typeof value !== 'string') continue;
      const match = value.replace(/\s+/g, ' ').trim().match(/^(?:group|grp)\.?\s*[:\-]?\s*([abc])$/i);
      if (match) {
        headers.push({ row: r, col: c, group: match[1].toUpperCase() });
        break;
      }
    }
  }
  return headers;
}

/**
 * Parse the weekly sheet into class rows without touching the database.
 */
export function parseTimetableWorkbook(buffer) {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: false });

  const candidates = [];
  for (const name of workbook.SheetNames) {
    if (IGNORED_SHEET.test(name)) continue;
    const sheet = workbook.Sheets[name];
    const probe = buildGrid(sheet);
    const header = findDayHeader(probe.grid, probe.rows, probe.cols, 0, probe.rows - 1);
    if (header) candidates.push({ name, header, grid: probe });
  }

  if (candidates.length === 0) {
    const err = new Error(
      'No weekly timetable sheet found. Expected a sheet with Monday to Saturday columns and 15-minute time rows.'
    );
    err.code = 'NO_TIMETABLE_SHEET';
    throw err;
  }

  candidates.sort((a, b) => b.header.count - a.header.count);
  const chosen = candidates[0];
  const { name: sheetName, grid: built } = chosen;
  const { grid, rows, cols, anchorAt, covered } = built;

  const groupHeaders = findGroupHeaders(grid, rows, cols);
  const sections = [];
  const sameRow =
    groupHeaders.length > 1 && groupHeaders.every((h) => h.row === groupHeaders[0].row);

  if (groupHeaders.length === 0) {
    sections.push({ group: null, startRow: 0, endRow: rows - 1, colStart: 0, colEnd: cols - 1 });
  } else if (sameRow) {
    groupHeaders.sort((a, b) => a.col - b.col);
    for (let i = 0; i < groupHeaders.length; i += 1) {
      sections.push({
        group: groupHeaders[i].group,
        startRow: groupHeaders[i].row,
        endRow: rows - 1,
        colStart: groupHeaders[i].col,
        colEnd: i + 1 < groupHeaders.length ? groupHeaders[i + 1].col - 1 : cols - 1,
      });
    }
  } else {
    groupHeaders.sort((a, b) => a.row - b.row);
    for (let i = 0; i < groupHeaders.length; i += 1) {
      sections.push({
        group: groupHeaders[i].group,
        startRow: groupHeaders[i].row,
        endRow: i + 1 < groupHeaders.length ? groupHeaders[i + 1].row - 1 : rows - 1,
        colStart: 0,
        colEnd: cols - 1,
      });
    }
  }

  const classes = [];
  const warnings = [];

  for (const section of sections) {
    const header =
      findDayHeader(
        grid,
        rows,
        cols,
        section.startRow,
        section.endRow,
        section.colStart,
        section.colEnd
      ) || findDayHeader(grid, rows, cols, 0, rows - 1, section.colStart, section.colEnd);

    if (!header) continue;

    const dayColumns = header.columns;
    const firstDataRow = header.row + 1;
    const resolver = makeTimeResolver(
      grid,
      rows,
      cols,
      firstDataRow,
      section.endRow,
      dayColumns,
      section.colStart,
      section.colEnd
    );

    for (const [dayOfWeekStr, col] of Object.entries(dayColumns)) {
      const dayOfWeek = Number(dayOfWeekStr);

      for (let r = firstDataRow; r <= section.endRow; r += 1) {
        if (covered.has(`${r},${col}`)) continue;

        const value = grid[r][col];
        if (value === null || value === undefined || value === '') continue;
        if (typeof value === 'string' && isIgnoredCell(value)) continue;

        const merge = anchorAt.get(`${r},${col}`);
        const endRow = merge ? merge.r2 : r;

        const parsed = parseClassCell(value);
        if (!parsed) {
          warnings.push({
            sheetRow: r + 1,
            dayOfWeek,
            column: col + 1,
            value: String(value),
            reason: 'Cell is not a readable class (course, group, teacher, room).',
          });
          continue;
        }

        const startMinutes = resolver.resolve(r);
        const endMinutes = resolver.resolve(endRow) + resolver.step;

        if (endMinutes <= startMinutes) {
          warnings.push({
            sheetRow: r + 1,
            dayOfWeek,
            column: col + 1,
            value: String(value),
            reason: 'Could not determine a valid start and end time for this class.',
          });
          continue;
        }

        classes.push({
          sheetRow: r + 1,
          column: col + 1,
          dayOfWeek,
          startTime: minutesToTime(startMinutes),
          endTime: minutesToTime(endMinutes),
          course: parsed.course,
          teacher: parsed.teacher,
          group: parsed.group || section.group,
          roomName: parsed.roomName,
          raw: String(value),
        });
      }
    }
  }

  return { sheetName, classes, warnings };
}

function timesOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && aEnd > bStart;
}

function timetableKey(row) {
  return `${row.room_id}|${row.day_of_week}|${row.start}|${row.end}|${row.course}|${row.teacher}`;
}

/**
 * Import parsed rows into the timetable for a building.
 */
export async function importTimetable({
  buffer,
  buildingId,
  termId = null,
  validFrom,
  validTo,
  saveValidRowsOnly = false,
}) {
  const parsed = parseTimetableWorkbook(buffer);

  const client = await getClient();
  const errors = [];
  const unmapped = new Map();

  try {
    await client.query('BEGIN');

    const roomRes = await client.query(
      'SELECT id, name, parent_room_id FROM rooms WHERE building_id = $1',
      [buildingId]
    );
    if (roomRes.rows.length === 0) {
      const err = new Error(`No rooms found for building ${buildingId}.`);
      err.code = 'NO_ROOMS';
      throw err;
    }

    const roomsById = new Map(roomRes.rows.map((room) => [room.id, room]));
    const roomByKey = new Map(
      roomRes.rows.map((room) => [normalizeRoomKey(room.name), room])
    );

    const aliasRes = await client.query(
      `SELECT a.alias, a.room_id
       FROM room_aliases a
       JOIN rooms r ON r.id = a.room_id
       WHERE r.building_id = $1`,
      [buildingId]
    );
    const aliasByKey = new Map(
      aliasRes.rows.map((row) => [normalizeRoomKey(row.alias), row.room_id])
    );

    const resolveRoomId = (name) => {
      const key = normalizeRoomKey(name);
      if (!key) return null;
      if (aliasByKey.has(key)) return aliasByKey.get(key);
      if (roomByKey.has(key)) return roomByKey.get(key).id;
      return null;
    };

    const relatedRoomIds = (roomId) => {
      const ids = new Set([roomId]);
      const room = roomsById.get(roomId);
      if (room && room.parent_room_id) ids.add(room.parent_room_id);
      for (const other of roomsById.values()) {
        if (other.parent_room_id === roomId) ids.add(other.id);
      }
      return [...ids];
    };

    const existingRes = await client.query(
      `SELECT te.id, te.room_id, te.course_name, te.teacher, te.day_of_week,
              te.start_time, te.end_time
       FROM timetable_entries te
       JOIN rooms r ON r.id = te.room_id
       WHERE r.building_id = $1
         AND te.valid_from <= $3
         AND te.valid_to >= $2`,
      [buildingId, validFrom, validTo]
    );

    const existing = existingRes.rows.map((row) => ({
      room_id: row.room_id,
      course: String(row.course_name || '').toLowerCase().trim(),
      teacher: String(row.teacher || '').toLowerCase().trim(),
      day_of_week: row.day_of_week,
      start: String(row.start_time).slice(0, 5),
      end: String(row.end_time).slice(0, 5),
    }));

    const accepted = [];
    let duplicates = 0;

    for (const cls of parsed.classes) {
      if (!cls.roomName) {
        errors.push({
          sheetRow: cls.sheetRow,
          dayOfWeek: cls.dayOfWeek,
          value: cls.raw,
          reason: 'Could not determine a room for this class.',
        });
        continue;
      }

      const roomId = resolveRoomId(cls.roomName);
      if (!roomId) {
        unmapped.set(normalizeRoomKey(cls.roomName), cls.roomName);
        errors.push({
          sheetRow: cls.sheetRow,
          dayOfWeek: cls.dayOfWeek,
          value: cls.raw,
          reason: `Unknown room "${cls.roomName}". Add a room alias for it, then re-upload.`,
        });
        continue;
      }

            const candidate = {
        room_id: roomId,
        course: cls.course.toLowerCase().trim(),
        teacher: (cls.teacher || '').toLowerCase().trim(),
        day_of_week: cls.dayOfWeek,
        start: cls.startTime,
        end: cls.endTime,
      };

      const key = timetableKey(candidate);
      const existingDuplicate = existing.some((row) => timetableKey(row) === key);
      const uploadDuplicate = accepted.some((row) => timetableKey(row) === key);
      if (existingDuplicate || uploadDuplicate) {
        duplicates += 1;
        continue;
      }

      const targetRooms = new Set(relatedRoomIds(roomId));

      const clashesWithExisting = existing.some(
        (row) =>
          targetRooms.has(row.room_id) &&
          row.day_of_week === cls.dayOfWeek &&
          timesOverlap(cls.startTime, cls.endTime, row.start, row.end)
      );

      const clashesWithinUpload = accepted.some(
        (row) =>
          targetRooms.has(row.room_id) &&
          row.day_of_week === cls.dayOfWeek &&
          timesOverlap(cls.startTime, cls.endTime, row.start, row.end)
      );

      if (clashesWithExisting || clashesWithinUpload) {
        errors.push({
          sheetRow: cls.sheetRow,
          dayOfWeek: cls.dayOfWeek,
          value: cls.raw,
          reason: `Time clash in room ${roomsById.get(roomId).name} on day ${cls.dayOfWeek} ${cls.startTime}-${cls.endTime}.`,
        });
        continue;
      }

      accepted.push({
        ...candidate,
        course_name: cls.course,
        teacher_name: cls.teacher,
        group_name: cls.group,
        sheetRow: cls.sheetRow,
      });
    }

    if (errors.length > 0 && !saveValidRowsOnly) {
      await client.query('ROLLBACK');
      return {
        committed: false,
        sheetName: parsed.sheetName,
        parsedCount: parsed.classes.length,
        savedCount: 0,
        duplicateCount: duplicates,
        errors: [...parsed.warnings, ...errors],
        unmappedRooms: [...unmapped.values()],
        message: 'Upload rejected because some rows were invalid. Nothing was saved.',
      };
    }

    let savedCount = 0;
    for (const row of accepted) {
      await client.query(
        `INSERT INTO timetable_entries
           (room_id, term_id, course_name, teacher, group_name, day_of_week, start_time, end_time, valid_from, valid_to)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          row.room_id,
          termId,
          row.course_name,
          row.teacher_name,
          row.group_name,
          row.day_of_week,
          row.start,
          row.end,
          validFrom,
          validTo,
        ]
      );
      savedCount += 1;
    }

    await client.query('COMMIT');

    return {
      committed: true,
      sheetName: parsed.sheetName,
      parsedCount: parsed.classes.length,
      savedCount,
      duplicateCount: duplicates,
      errors: [...parsed.warnings, ...errors],
      unmappedRooms: [...unmapped.values()],
      message:
        errors.length > 0
          ? 'Valid rows were saved. Fix the reported rows and upload them again.'
          : 'Timetable imported successfully.',
    };
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // ignore rollback failure
    }
    throw err;
  } finally {
    client.release();
  }
}
