import fs from 'fs';
import path from 'path';
import XLSX from 'xlsx';
import { getClient } from '../config/db.js';
import { toDateStr } from '../utils/timezone.js';

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
    .replace(/\bcla+s+\b/gi, 'class')
    .replace(/\bclss\b/gi, 'class')
    .replace(/\bist\b/gi, '1st')
    .replace(/\bfirst\b/gi, '1st')
    .replace(/\bsecond\b/gi, '2nd')
    .replace(/[,;:]+/g, ' ')
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

export function isPhysicalRoomLine(line) {
  if (!line || typeof line !== 'string') return false;
  const trimmed = line.trim();

  // 1. Blacklist: course tracks or virtual markers containing "classroom"
  if (/^(?:l&d\s+classroom|virtual\s+classroom|google\s+classroom|online\s+classroom)/i.test(trimmed)) {
    return false;
  }

  // 2. Whitelist: only actual physical campus room specifications:
  // e.g. Classroom A, Classroom B, Classroom C, Classroom 1A, Classroom 1B, Classroom 2A, Classroom 2B, Classroom 2C,
  // Classroom B1+B2 2nd Floor, Classroom B1, Classroom B2, Class B1 2nd floor, C groundfloor, 0C, etc.
  return /(?:(?:classroom|cla?a?ss(?:room)?|clss|room|block)\s+(?:[012]?[a-c]\d*\b|b1\s*(?:\+|\/|and)\s*b2\b|[a-c]\b)|c\s*(?:ground\s*floor|groundfloor)|\b(?:ground|1st|ist|2nd)\s*floor\s*.*[a-c]\b|\b[012]?[a-c]\s+(?:ground|1st|ist|2nd)\s*floor\b|\b[12][a-c]\d*\b|\bssb(?:\s+classroom)?\b)/i.test(trimmed);
}

/**
 * Parse a class cell such as
 * "MERN - 2029, Grp A, (Mrinal), Classroom A 1st floor" or multi-line cell.
 * Extracts course, subject, group(s), teacher, roomName, and entryType ('class', 'lab', 'club').
 * Returns null when the text is not usable.
 */
export function parseClassCell(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'string') return null;

  const rawTrimmed = raw.trim();
  if (!rawTrimmed || isIgnoredCell(rawTrimmed)) return null;

  const dateMatch = rawTrimmed.match(/\b(202[0-9]-[01][0-9]-[0-3][0-9])\b/);
  const cellDate = dateMatch ? dateMatch[1] : null;

  // Standalone lab cell (including L&D track lab cells)
  if (/^lab$/i.test(rawTrimmed) || /^l&d\s+classroom\s+\d+\s*-\s*.*lab$/i.test(rawTrimmed)) {
    const labSubject = rawTrimmed
      .replace(/^l&d\s+classroom\s+\d+\s*-\s*/i, '')
      .replace(/\s*-\s*202[0-9](?:\s*\+\s*202[0-9])*\b/g, '')
      .replace(/\blab\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim() || 'Lab';
    return {
      isLabOnly: true,
      course: `${labSubject} (Lab)`,
      subject: labSubject,
      group: null,
      groups: [],
      teacher: null,
      roomName: null,
      entryType: 'lab',
      ...(cellDate ? { date: cellDate } : {}),
    };
  }

  const isClub = /academic clubs/i.test(rawTrimmed);
  const isLab = /\blab\b/i.test(rawTrimmed);

  const lines = rawTrimmed.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  let teacher = null;
  let roomName = null;
  const groups = [];

  // Check for room inside parentheses e.g. 'FDE (Classroom A, 2nd Floor)'
  const parenMatch = rawTrimmed.match(/\(([^)]*)\)/);
  if (parenMatch) {
    const inside = parenMatch[1].trim();
    if (isPhysicalRoomLine(inside) || /(classroom|class|floor|ground)/i.test(inside)) {
      roomName = inside;
    } else {
      teacher = inside || null;
    }
  }

  if (lines.length > 1) {
    const remainingLines = [];
    for (const line of lines) {
      const tMatch = line.match(/^\(([^)]+)\)$/);
      if (tMatch && !/(classroom|cla?a?ss(?:room)?|clss|floor|ground)/i.test(tMatch[1])) {
        teacher = tMatch[1].trim();
        continue;
      }

      if (!roomName && isPhysicalRoomLine(line)) {
        roomName = line.trim();
        continue;
      }

      const grpMatch = line.match(/\b(?:group|grp)\.?\s*[:\-]?\s*([a-z0-9]+(?:\s*\+\s*[a-z0-9]+)*)\b/i);
      if (grpMatch) {
        const parts = grpMatch[1].split('+').map((g) => g.trim().toUpperCase());
        groups.push(...parts);
        const remainingLine = line.replace(grpMatch[0], '').replace(/\s+/g, ' ').trim();
        if (remainingLine && !/^[,\-:]+$/.test(remainingLine)) {
          remainingLines.push(remainingLine);
        }
        continue;
      }

      if (/^\[.*\]$/.test(line)) {
        continue;
      }

      remainingLines.push(line);
    }

    let courseStr = remainingLines.join(' ');
    courseStr = courseStr.replace(/\([^)]*\)/g, ' ');
    const cleanSubject = courseStr
      .replace(/\s*-\s*202[0-9](?:\s*\+\s*202[0-9])*\b/g, '')
      .replace(/^l&d\s+classroom\s+\d+\s*-\s*/i, '')
      .replace(/\bLAB\b/gi, '')
      .replace(/\[[^\]]*\]/g, '')
      .replace(/\b(?:group|grp)\.?\s*[:\-]?\s*([a-z0-9]+(?:\s*\+\s*[a-z0-9]+)*)\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim();

    const cleanCourse = courseStr.replace(/\s+/g, ' ').trim();

    return {
      course: cleanCourse || cleanSubject || rawTrimmed,
      subject: cleanSubject || (isClub ? 'Academic Clubs' : cleanCourse),
      group: groups[0] || null,
      groups: [...new Set(groups)],
      teacher,
      roomName,
      entryType: isClub ? 'club' : (isLab ? 'lab' : 'class'),
      ...(cellDate ? { date: cellDate } : {}),
    };
  }

  // Single-line format (e.g. comma-separated)
  let rest = rawTrimmed.replace(/\([^)]*\)/g, ' ');

  const groupMatch = rest.match(/\b(?:group|grp)\.?\s*[:\-]?\s*([a-z0-9]+(?:\s*\+\s*[a-z0-9]+)*)\b/i);
  if (groupMatch) {
    const parts = groupMatch[1].split('+').map((g) => g.trim().toUpperCase());
    groups.push(...parts);
    rest = rest.replace(groupMatch[0], ' ');
  }

  const parts = rest
    .split(',')
    .map((part) => part.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  if (parts.length === 0) return null;

  if (parts.length >= 2 && !roomName) {
    if (isPhysicalRoomLine(parts[parts.length - 1])) {
      roomName = parts.pop();
    }
  }

  if (!roomName) {
    const roomMatch = rest.match(/\b(?:(?:classroom|cla?a?ss(?:room)?|clss|room)\s+[12]?[a-c]\d*\b.*|c\s*groundfloor|ground\s*floor|\b[12][a-c]\d*\b|\b\d+(?:st|nd|rd|th)?\s*floor\b.*)/i);
    if (roomMatch && isPhysicalRoomLine(roomMatch[0])) {
      roomName = roomMatch[0].trim();
      rest = rest.replace(roomMatch[0], ' ');
    }
  }

  const course = parts
    .join(', ')
    .replace(/[\s,;:-]+$/, '')
    .trim();

  const cleanSubject = course
    .replace(/\s*-\s*202[0-9]\b/g, '')
    .replace(/\bLAB\b/gi, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!course && !roomName) return null;

  return {
    course: course || rawTrimmed,
    subject: cleanSubject || (isClub ? 'Academic Clubs' : course),
    group: groups[0] || null,
    groups: [...new Set(groups)],
    teacher,
    roomName,
    entryType: isClub ? 'club' : (isLab ? 'lab' : 'class'),
    ...(cellDate ? { date: cellDate } : {}),
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
  const maxRow = Math.min(rows, 10);
  for (let r = 0; r < maxRow; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const value = grid[r][c];
      if (typeof value !== 'string') continue;
      const clean = value.replace(/\s+/g, ' ').trim();
      const match = clean.match(/\b(?:group|grp)\.?\s*[:\-]?\s*([a-z0-9]+)\b/i);
      if (match) {
        headers.push({ row: r, col: c, group: match[1].toUpperCase() });
      }
    }
    if (headers.length > 0) {
      break;
    }
  }
  return headers;
}

/**
 * Parse the weekly sheet into class rows without touching the database.
 */
export function parseTimetableWorkbook(buffer) {
  const buf = typeof buffer === 'string'
    ? fs.readFileSync(buffer)
    : buffer;
  const workbook = XLSX.read(buf, { type: 'buffer', cellDates: false });

  const candidates = [];
  const safeSheetNames = (workbook.SheetNames || []).filter(
    (name) => name !== '__proto__' && name !== 'constructor' && name !== 'prototype'
  );
  for (const name of safeSheetNames) {
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
    // Skip Group E totally (new off-campus EC SST Classroom)
    if (section.group === 'E') {
      continue;
    }
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
      let lastClassInCol = null;

      for (let r = firstDataRow; r <= section.endRow; r += 1) {
        if (covered.has(`${r},${col}`)) continue;

        const value = grid[r][col];
        if (value === null || value === undefined || value === '') continue;
        if (typeof value === 'string' && isIgnoredCell(value)) continue;

        const merge = anchorAt.get(`${r},${col}`);
        const endRow = merge ? merge.r2 : r;

        const rawStr = String(value);
        if (
          section.group === 'E' ||
          /\b(?:group|grp)\.?\s*e\b/i.test(rawStr) ||
          /ec\s*sst/i.test(rawStr)
        ) {
          continue; // Skip Group E totally (new off-campus EC SST Classroom)
        }

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

        if (
          parsed.group === 'E' ||
          (parsed.groups && parsed.groups.includes('E'))
        ) {
          continue; // Skip Group E totally (new off-campus EC SST Classroom)
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

        // Handle standalone Lab cell (C21)
        if (parsed.isLabOnly) {
          if (lastClassInCol) {
            const inheritedSub = (parsed.subject && parsed.subject !== 'Lab') ? parsed.subject : lastClassInCol.subject;
            const labClass = {
              sheetRow: r + 1,
              column: col + 1,
              dayOfWeek,
              startTime: minutesToTime(startMinutes),
              endTime: minutesToTime(endMinutes),
              course: `${inheritedSub} (Lab)`,
              subject: inheritedSub,
              teacher: parsed.teacher || lastClassInCol.teacher,
              group: lastClassInCol.group,
              groups: lastClassInCol.groups,
              roomName: parsed.roomName || lastClassInCol.roomName,
              entryType: 'lab',
              raw: String(value),
            };
            classes.push(labClass);
          } else {
            warnings.push({
              sheetRow: r + 1,
              dayOfWeek,
              column: col + 1,
              value: String(value),
              reason: 'Standalone Lab cell has no class above it in the column to inherit from.',
            });
          }
          continue;
        }

        const explicitGroups = parsed.groups.length > 0
          ? parsed.groups
          : (parsed.group ? [parsed.group] : []);

        const classObj = {
          sheetRow: r + 1,
          column: col + 1,
          dayOfWeek,
          startTime: minutesToTime(startMinutes),
          endTime: minutesToTime(endMinutes),
          course: parsed.course,
          subject: parsed.subject || parsed.course,
          teacher: parsed.teacher,
          group: explicitGroups[0] || (explicitGroups.length === 0 ? null : section.group),
          groups: explicitGroups,
          roomName: parsed.roomName,
          entryType: parsed.entryType || 'class',
          date: parsed.date || null,
          raw: String(value),
        };

        classes.push(classObj);
        lastClassInCol = classObj;
      }
    }
  }

  return { sheetName, classes, warnings };
}

function timesOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && aEnd > bStart;
}

function timetableKey(row) {
  return `${row.term_id || ''}|${row.room_id}|${row.day_of_week}|${row.start}|${row.end}|${row.course}|${row.teacher}`;
}

/**
 * Import parsed rows into the timetable for a building.
 */
export async function importTimetable(fileOrOptions, maybeOptions = {}) {
  let options = {};
  if (Buffer.isBuffer(fileOrOptions) || typeof fileOrOptions === 'string') {
    options = {
      buffer: fileOrOptions,
      filename: typeof fileOrOptions === 'string' ? path.basename(fileOrOptions) : null,
      ...maybeOptions,
    };
  } else if (fileOrOptions && typeof fileOrOptions === 'object') {
    options = { ...fileOrOptions, ...maybeOptions };
  }

  let {
    buffer,
    buildingId,
    termId = null,
    validFrom,
    validTo,
    saveValidRowsOnly = false,
    dryRun = false,
    batchYear,
    termNumber,
  } = options;

  const parsed = parseTimetableWorkbook(buffer);

  const client = await getClient();
  const errors = [];
  const unmapped = new Map();

  try {
    await client.query('BEGIN');

    if (!buildingId) {
      const bRes = await client.query('SELECT id FROM buildings ORDER BY id ASC LIMIT 1');
      if (bRes.rows.length > 0) {
        buildingId = bRes.rows[0].id;
      }
    }

    if (!termId && batchYear && termNumber) {
      const termLookup = await client.query(`
        SELECT t.id, t.start_date, t.end_date
        FROM terms t
        JOIN batches b ON b.id = t.batch_id
        WHERE b.year = $1 AND t.term_number = $2
      `, [batchYear, termNumber]);
      if (termLookup.rows.length > 0) {
        termId = termLookup.rows[0].id;
        if (!validFrom) validFrom = termLookup.rows[0].start_date;
        if (!validTo) validTo = termLookup.rows[0].end_date;
      }
    }

    if (!termId) {
      const err = new Error(
        `Term record not found for Batch ${batchYear || 'unknown'} Term ${termNumber || 'unknown'}. Please create the term before importing timetable.`
      );
      err.code = 'TERM_NOT_FOUND';
      throw err;
    }

    const roomRes = await client.query(
      'SELECT id, name, floor, parent_room_id FROM rooms WHERE building_id = $1',
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

    // Auto-seed standard room aliases for common variations (Class B 2nd floor, Claas A, etc.)
    const defaultAliases = [
      { pattern: /2b1/i, floor: '2nd', alias: 'Class B1 2nd floor' },
      { pattern: /2b1/i, floor: '2nd', alias: 'Classroom B1 2nd floor' },
      { pattern: /2b2/i, floor: '2nd', alias: 'Class B2 2nd floor' },
      { pattern: /2b2/i, floor: '2nd', alias: 'Classroom B2 2nd floor' },
      { pattern: /2b$/i, floor: '2nd', alias: 'Class B 2nd floor' },
      { pattern: /2b$/i, floor: '2nd', alias: 'Classroom B 2nd floor' },
      { pattern: /2b$/i, floor: '2nd', alias: 'Class B, 2nd Floor' },
      { pattern: /2b$/i, floor: '2nd', alias: 'Classroom B, 2nd Floor' },
      { pattern: /2b$/i, floor: '2nd', alias: 'Classroom B1+B2 2nd Floor' },
      { pattern: /2b$/i, floor: '2nd', alias: 'Classroom B1+B2 2nd floor' },
      { pattern: /2b$/i, floor: '2nd', alias: 'Classroom B1+B2' },
      { pattern: /2b$/i, floor: '2nd', alias: 'Class B1+B2 2nd floor' },
      { pattern: /2b$/i, floor: '2nd', alias: 'Class B1+B2 2nd Floor' },
      { pattern: /2b$/i, floor: '2nd', alias: 'B1+B2 2nd floor' },
      { pattern: /2b$/i, floor: '2nd', alias: 'B1+B2 2nd Floor' },
      { pattern: /2a/i, floor: '2nd', alias: 'Class A 2nd floor' },
      { pattern: /2a/i, floor: '2nd', alias: 'Claas A 2nd floor' },
      { pattern: /2a/i, floor: '2nd', alias: 'Classroom A 2nd floor' },
      { pattern: /2a/i, floor: '2nd', alias: 'Classroom A, 2nd Floor' },
      { pattern: /2c/i, floor: '2nd', alias: 'Class C 2nd floor' },
      { pattern: /2c/i, floor: '2nd', alias: 'Classroom C 2nd floor' },
      { pattern: /2c/i, floor: '2nd', alias: 'Classroom C, 2nd Floor' },
      { pattern: /1a/i, floor: '1st', alias: 'Class A 1st floor' },
      { pattern: /1a/i, floor: '1st', alias: 'Classroom A 1st floor' },
      { pattern: /1b/i, floor: '1st', alias: 'Class B 1st floor' },
      { pattern: /1b/i, floor: '1st', alias: 'Classroom B 1st floor' },
      { pattern: /^c$/i, floor: 'Ground', alias: 'Class C Ground floor' },
      { pattern: /^c$/i, floor: 'Ground', alias: 'Classroom C' },
      { pattern: /^c$/i, floor: 'Ground', alias: 'C groundfloor' },
      { pattern: /^ssb$/i, alias: 'SSB Classroom' },
      { pattern: /^ssb$/i, alias: 'ssb' },
    ];

    for (const def of defaultAliases) {
      for (const r of roomsById.values()) {
        if (def.pattern.test(r.name) && (!def.floor || r.floor?.toLowerCase().includes(def.floor.toLowerCase()))) {
          const norm = normalizeRoomKey(def.alias);
          if (!aliasByKey.has(norm)) {
            aliasByKey.set(norm, r.id);
            try {
              await client.query(
                `INSERT INTO room_aliases (alias, room_id) VALUES ($1, $2) ON CONFLICT (alias) DO NOTHING`,
                [def.alias, r.id]
              );
            } catch (aliasErr) {
              console.warn(`Could not seed alias "${def.alias}":`, aliasErr.message);
            }
          }
        }
      }
    }

    const resolveRoomId = (name) => {
      const key = normalizeRoomKey(name);
      if (!key) return null;
      if (aliasByKey.has(key)) return aliasByKey.get(key);
      if (roomByKey.has(key)) return roomByKey.get(key).id;

      // PRD v2 C21 room variations fallback matching
      if (/c\s*(?:ground\s*floor|groundfloor)/i.test(key) || /(?:ground\s*floor|groundfloor)\s*.*c/i.test(key) || key === 'c ground floor' || key === 'class c ground floor' || key === 'classroom c') {
        for (const r of roomsById.values()) {
          if (r.floor?.toLowerCase().includes('ground') && r.name.toLowerCase() === 'c') return r.id;
        }
      }
      if (/b\s*1st\s*floor/i.test(key) || /1st\s*floor\s*.*b/i.test(key) || /\b1b\b/i.test(key) || key === 'class b 1st floor' || key === 'classroom b 1st floor') {
        for (const r of roomsById.values()) {
          if (r.floor?.toLowerCase().includes('1st') && (r.name.toLowerCase() === '1b' || r.name.toLowerCase() === 'b')) return r.id;
        }
      }
      if (/a\s*(?:1st|ist)\s*floor/i.test(key) || /(?:1st|ist)\s*floor\s*.*a/i.test(key) || /\b1a\b/i.test(key) || key === 'class a 1st floor' || key === 'classroom a 1st floor') {
        for (const r of roomsById.values()) {
          if (r.floor?.toLowerCase().includes('1st') && (r.name.toLowerCase() === '1a' || r.name.toLowerCase() === 'a')) return r.id;
        }
      }
      if (/a\s*2nd\s*floor/i.test(key) || /2nd\s*floor\s*.*a/i.test(key) || /\b2a\b/i.test(key) || key === 'class a 2nd floor' || key === 'classroom a 2nd floor') {
        for (const r of roomsById.values()) {
          if (r.floor?.toLowerCase().includes('2nd') && (r.name.toLowerCase() === '2a' || r.name.toLowerCase() === 'a')) return r.id;
        }
      }
      // B1+B2 combined room resolves to parent room 2B
      if (
        /b1\s*(?:\+|\/|and)\s*b2/i.test(key) ||
        /b\s*1\s*\+\s*2/i.test(key) ||
        key.includes('b1+b2') ||
        key.includes('b1 + b2') ||
        key.includes('b1 and b2') ||
        key.includes('b1/b2') ||
        key === 'class b1+b2 2nd floor' ||
        key === 'classroom b1+b2 2nd floor'
      ) {
        for (const r of roomsById.values()) {
          if (r.floor?.toLowerCase().includes('2nd') && (r.name.toLowerCase() === '2b' || r.name.toLowerCase() === 'b')) return r.id;
        }
      }
      if (/b1\s*2nd\s*floor/i.test(key) || /2nd\s*floor\s*.*b1/i.test(key) || /\b2b1\b/i.test(key) || key === 'class b1 2nd floor' || key === 'classroom b1 2nd floor') {
        for (const r of roomsById.values()) {
          if (r.floor?.toLowerCase().includes('2nd') && (r.name.toLowerCase() === '2b1' || r.name.toLowerCase() === 'b1')) return r.id;
        }
      }
      if (/b2\s*2nd\s*floor/i.test(key) || /2nd\s*floor\s*.*b2/i.test(key) || /\b2b2\b/i.test(key) || key === 'class b2 2nd floor' || key === 'classroom b2 2nd floor') {
        for (const r of roomsById.values()) {
          if (r.floor?.toLowerCase().includes('2nd') && (r.name.toLowerCase() === '2b2' || r.name.toLowerCase() === 'b2')) return r.id;
        }
      }
      if (/b\s*2nd\s*floor/i.test(key) || /2nd\s*floor\s*.*b/i.test(key) || /\b2b\b/i.test(key) || key === 'class b 2nd floor' || key === 'classroom b 2nd floor') {
        for (const r of roomsById.values()) {
          if (r.floor?.toLowerCase().includes('2nd') && (r.name.toLowerCase() === '2b' || r.name.toLowerCase() === 'b')) return r.id;
        }
      }
      if (/c\s*2nd\s*floor/i.test(key) || /2nd\s*floor\s*.*c/i.test(key) || /\b2c\b/i.test(key) || key === 'class c 2nd floor' || key === 'classroom c 2nd floor') {
        for (const r of roomsById.values()) {
          if (r.floor?.toLowerCase().includes('2nd') && (r.name.toLowerCase() === '2c' || r.name.toLowerCase() === 'c')) return r.id;
        }
      }

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

    let batchId = null;
    let batchYearResolved = null;
    let termStart = null;
    let termEnd = null;
    if (termId) {
      if (options.replace) {
        await client.query('DELETE FROM timetable_entries WHERE term_id = $1', [termId]);
      }
      const termRes = await client.query(
        `SELECT t.batch_id, b.year as batch_year, t.start_date, t.end_date
         FROM terms t
         JOIN batches b ON b.id = t.batch_id
         WHERE t.id = $1`,
        [termId]
      );
      if (termRes.rows.length > 0) {
        batchId = termRes.rows[0].batch_id;
        batchYearResolved = termRes.rows[0].batch_year;
        termStart = termRes.rows[0].start_date instanceof Date
          ? toDateStr(termRes.rows[0].start_date)
          : String(termRes.rows[0].start_date).slice(0, 10);
        termEnd = termRes.rows[0].end_date instanceof Date
          ? toDateStr(termRes.rows[0].end_date)
          : String(termRes.rows[0].end_date).slice(0, 10);

        if (validFrom && (validFrom < termStart || validFrom > termEnd)) {
          errors.push({
            sheetRow: 0,
            column: 'validFrom',
            value: validFrom,
            reason: `Timetable start date (${validFrom}) is outside term dates (${termStart} to ${termEnd}).`,
          });
        }
        if (validTo && (validTo > termEnd || validTo < termStart)) {
          errors.push({
            sheetRow: 0,
            column: 'validTo',
            value: validTo,
            reason: `Timetable end date (${validTo}) is outside term dates (${termStart} to ${termEnd}).`,
          });
        }

        if (!validFrom) validFrom = termStart;
        if (!validTo) validTo = termEnd;
      }
    }

    if (!validFrom) validFrom = '2000-01-01';
    if (!validTo) validTo = '2099-12-31';

    const existingRes = await client.query(
      `SELECT te.id, te.room_id, te.course_name, te.teacher, te.day_of_week,
              te.start_time, te.end_time, te.entry_type, te.term_id, t.batch_id,
              b.year as batch_year
       FROM timetable_entries te
       JOIN rooms r ON r.id = te.room_id
       LEFT JOIN terms t ON te.term_id = t.id
       LEFT JOIN batches b ON t.batch_id = b.id
       WHERE r.building_id = $1
         AND te.valid_from <= $3
         AND te.valid_to >= $2`,
      [buildingId, validFrom, validTo]
    );

    const existing = existingRes.rows.map((row) => ({
      term_id: row.term_id,
      room_id: row.room_id,
      course: String(row.course_name || '').toLowerCase().trim(),
      teacher: String(row.teacher || '').toLowerCase().trim(),
      day_of_week: row.day_of_week,
      start: String(row.start_time).slice(0, 5),
      end: String(row.end_time).slice(0, 5),
      entry_type: row.entry_type || 'class',
      batch_id: row.batch_id,
      batch_year: row.batch_year,
    }));

    const accepted = [];
    const warnings = [];
    let duplicates = 0;

    for (const cls of parsed.classes) {
      // Skip Group E totally (new off-campus EC SST Classroom)
      const isGroupE =
        cls.group === 'E' ||
        (cls.groups && cls.groups.includes('E')) ||
        /\b(?:group|grp)\.?\s*e\b/i.test(cls.raw || '') ||
        /ec\s*sst/i.test(cls.raw || '');

      if (isGroupE) {
        continue;
      }

      // C11: A timetable row outside its term's dates is rejected with a row error
      if (cls.date && termStart && termEnd && (cls.date < termStart || cls.date > termEnd)) {
        errors.push({
          sheetRow: cls.sheetRow,
          dayOfWeek: cls.dayOfWeek,
          value: cls.raw,
          reason: `Class date (${cls.date}) is outside term dates (${termStart} to ${termEnd}).`,
        });
        continue;
      }

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

      const targetRooms = new Set(relatedRoomIds(roomId));

      // Club deduplication (C22): same club event appearing in two sheets is saved once
      if (cls.entryType === 'club') {
        const isClubDup = existing.some(
          (row) =>
            targetRooms.has(row.room_id) &&
            row.day_of_week === cls.dayOfWeek &&
            timesOverlap(cls.startTime, cls.endTime, row.start, row.end) &&
            (row.entry_type === 'club' || row.course.includes('club'))
        ) || accepted.some(
          (row) =>
            targetRooms.has(row.room_id) &&
            row.day_of_week === cls.dayOfWeek &&
            timesOverlap(cls.startTime, cls.endTime, row.start, row.end) &&
            (row.entry_type === 'club' || row.course.includes('club'))
        );

        if (isClubDup) {
          duplicates += 1;
          continue;
        }
      }

      const candidate = {
        term_id: termId,
        room_id: roomId,
        course: cls.course.toLowerCase().trim(),
        teacher: (cls.teacher || '').toLowerCase().trim(),
        day_of_week: cls.dayOfWeek,
        start: cls.startTime,
        end: cls.endTime,
      };

      const key = timetableKey(candidate);
      const existingDuplicate = existing.some((row) => timetableKey(row) === key);
      const matchingAccepted = accepted.find((row) => timetableKey(row) === key);
      if (existingDuplicate || matchingAccepted) {
        if (matchingAccepted) {
          const currentGroups = matchingAccepted.groups || (matchingAccepted.group ? [matchingAccepted.group] : []);
          const incomingGroups = cls.groups?.length > 0 ? cls.groups : (cls.group ? [cls.group] : []);
          const merged = Array.from(new Set([...currentGroups, ...incomingGroups].filter(Boolean)));
          matchingAccepted.groups = merged;
          if (!matchingAccepted.group && merged.length > 0) {
            matchingAccepted.group = merged[0];
          }
          if (merged.length > 1) {
            matchingAccepted.group_name = merged.join(' + ');
          }
        }
        duplicates += 1;
        continue;
      }

      // Check clashes within current upload
      const clashesWithinUpload = accepted.some(
        (row) =>
          targetRooms.has(row.room_id) &&
          row.day_of_week === cls.dayOfWeek &&
          timesOverlap(cls.startTime, cls.endTime, row.start, row.end)
      );

      if (clashesWithinUpload) {
        errors.push({
          sheetRow: cls.sheetRow,
          dayOfWeek: cls.dayOfWeek,
          value: cls.raw,
          reason: `Time clash in room ${roomsById.get(roomId).name} on day ${cls.dayOfWeek} ${cls.startTime}-${cls.endTime}.`,
        });
        continue;
      }

      // Check clashes with existing entries: cross-batch overlap becomes warning per C22
      const clashingExisting = existing.filter(
        (row) =>
          targetRooms.has(row.room_id) &&
          row.day_of_week === cls.dayOfWeek &&
          timesOverlap(cls.startTime, cls.endTime, row.start, row.end)
      );

      let hasSameBatchClash = false;
      for (const clash of clashingExisting) {
        // A different term of the same batch (e.g. past Term 5 vs new Term 6) does not clash
        if (clash.term_id && termId && clash.term_id !== termId && clash.batch_id === batchId) {
          continue;
        }

        const isCrossBatch = clash.batch_id && batchId && clash.batch_id !== batchId;
        if (isCrossBatch) {
          warnings.push({
            sheetRow: cls.sheetRow,
            dayOfWeek: cls.dayOfWeek,
            value: cls.raw,
            reason: `Cross-batch overlap warning: class overlaps with Batch ${clash.batch_year} in room ${roomsById.get(roomId).name} on day ${cls.dayOfWeek} (${clash.start}-${clash.end}). Proceeding with upload per C22.`,
          });
        } else {
          hasSameBatchClash = true;
          errors.push({
            sheetRow: cls.sheetRow,
            dayOfWeek: cls.dayOfWeek,
            value: cls.raw,
            reason: `Time clash in room ${roomsById.get(roomId).name} on day ${cls.dayOfWeek} ${cls.startTime}-${cls.endTime}.`,
          });
        }
      }

      if (hasSameBatchClash) {
        continue;
      }

      accepted.push({
        ...candidate,
        course_name: cls.course,
        subject_name: cls.subject,
        teacher_name: cls.teacher,
        group_name: cls.group,
        groups: cls.groups || (cls.group ? [cls.group] : []),
        entry_type: cls.entryType || 'class',
        sheetRow: cls.sheetRow,
        raw_cell: cls.raw || null,
        sheet_name: parsed.sheetName || null,
        sheet_row: cls.sheetRow || null,
        sheet_col: cls.column || null,
        source_file: options.filename || options.sourceFilename || null,
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
        errors,
        warnings: [...parsed.warnings, ...warnings],
        unmappedRooms: [...unmapped.values()],
        message: 'Upload rejected because some rows were invalid. Nothing was saved.',
      };
    }

    if (dryRun) {
      await client.query('ROLLBACK');
      return {
        committed: false,
        dryRun: true,
        sheetName: parsed.sheetName,
        parsedCount: parsed.classes.length,
        savedCount: accepted.length,
        duplicateCount: duplicates,
        errors,
        warnings: [...parsed.warnings, ...warnings],
        unmappedRooms: [...unmapped.values()],
        message: 'Dry run completed. Parsed rows validated but no changes were committed.',
      };
    }

    let savedCount = 0;
    const subjectCache = new Map();
    const instructorCache = new Map();
    const groupCache = new Map();

    const getSubjectId = async (name) => {
      const trimmed = (name || '').trim();
      if (!trimmed) return null;
      const key = trimmed.toLowerCase();
      if (subjectCache.has(key)) return subjectCache.get(key);
      const res = await client.query(`
        INSERT INTO subjects (name, short_code)
        VALUES ($1, $1)
        ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
        RETURNING id
      `, [trimmed]);
      const id = res.rows[0].id;
      subjectCache.set(key, id);
      return id;
    };

    const getInstructorId = async (name) => {
      const trimmed = (name || '').trim();
      if (!trimmed) return null;
      const key = trimmed.toLowerCase();
      if (instructorCache.has(key)) return instructorCache.get(key);
      const res = await client.query(`
        INSERT INTO instructors (name)
        VALUES ($1)
        ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
        RETURNING id
      `, [trimmed]);
      const id = res.rows[0].id;
      instructorCache.set(key, id);
      return id;
    };

    const getGroupId = async (bId, name) => {
      if (!bId) return null;
      const trimmed = (name || '').trim().toUpperCase();
      if (!trimmed) return null;
      const key = `${bId}:${trimmed}`;
      if (groupCache.has(key)) return groupCache.get(key);
      const res = await client.query(`
        INSERT INTO groups (batch_id, name)
        VALUES ($1, $2)
        ON CONFLICT (batch_id, name) DO UPDATE SET name = EXCLUDED.name
        RETURNING id
      `, [bId, trimmed]);
      const id = res.rows[0].id;
      groupCache.set(key, id);
      return id;
    };

    for (const row of accepted) {
      const subjectId = await getSubjectId(row.subject_name || row.course_name);
      const instructorId = await getInstructorId(row.teacher_name);

      const groupIds = [];
      if (batchId && Array.isArray(row.groups) && row.groups.length > 0) {
        for (const gName of row.groups) {
          const gId = await getGroupId(batchId, gName);
          if (gId && !groupIds.includes(gId)) groupIds.push(gId);
        }
      } else if (batchId && row.group_name) {
        const gId = await getGroupId(batchId, row.group_name);
        if (gId) groupIds.push(gId);
      }

      const insertRes = await client.query(
        `INSERT INTO timetable_entries
           (room_id, term_id, subject_id, instructor_id, entry_type, day_of_week, start_time, end_time,
            course_name, teacher, group_name, valid_from, valid_to,
            raw_cell, sheet_name, sheet_row, sheet_col, source_file)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
         RETURNING id`,
        [
          row.room_id,
          termId,
          subjectId,
          instructorId,
          row.entry_type || 'class',
          row.day_of_week,
          row.start,
          row.end,
          row.course_name,
          row.teacher_name,
          (Array.isArray(row.groups) && row.groups.length > 1 ? row.groups.join(' + ') : (row.group_name || (Array.isArray(row.groups) && row.groups[0]) || null)),
          validFrom,
          validTo,
          row.raw_cell,
          row.sheet_name,
          row.sheet_row,
          row.sheet_col,
          row.source_file,
        ]
      );

      const entryId = insertRes.rows[0].id;
      for (const gId of groupIds) {
        await client.query(
          `INSERT INTO timetable_entry_groups (timetable_entry_id, group_id)
           VALUES ($1, $2)
           ON CONFLICT DO NOTHING`,
          [entryId, gId]
        );
      }
      savedCount += 1;
    }

    await client.query('COMMIT');

    return {
      committed: true,
      sheetName: parsed.sheetName,
      parsedCount: parsed.classes.length,
      savedCount,
      duplicateCount: duplicates,
      errors,
      warnings: [...parsed.warnings, ...warnings],
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
