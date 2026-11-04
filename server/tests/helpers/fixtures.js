import express from 'express';
import XLSX from 'xlsx';
import { selectWhere } from './fakeDb.js';

/** Serve a real router over HTTP. Returns its base URL and a close function. */
export async function startRouter(router) {
  const app = express();
  app.use(express.json());
  app.use(router);
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, () => resolve(listening));
  });
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

const FIRST_SLOT = 9 * 60;
const SLOT_MINUTES = 15;
const SLOT_COUNT = 48;
const FIRST_SLOT_ROW = 3;
const DAY_COLUMNS = { Monday: 2, Tuesday: 3, Wednesday: 4, Thursday: 5, Friday: 6, Saturday: 7 };

const minutes = (time) => {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
};
const clock = (total) => `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;

/** An .xlsx buffer in the college's layout, with each class merged across its time slots. */
export function buildTimetable(classes) {
  const aoa = [['Weekly Timetable'], ['Group A'], [null, 'Time', ...Object.keys(DAY_COLUMNS)]];
  for (let i = 0; i < SLOT_COUNT; i += 1) aoa.push([null, clock(FIRST_SLOT + i * SLOT_MINUTES)]);

  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  sheet['!merges'] = [];
  for (const { day = 'Monday', start, end, cell } of classes) {
    const firstRow = FIRST_SLOT_ROW + (minutes(start) - FIRST_SLOT) / SLOT_MINUTES;
    const lastRow = FIRST_SLOT_ROW + (minutes(end) - FIRST_SLOT) / SLOT_MINUTES - 1;
    const column = DAY_COLUMNS[day];
    sheet[XLSX.utils.encode_cell({ r: firstRow, c: column })] = { t: 's', v: cell };
    sheet['!merges'].push({ s: { r: firstRow, c: column }, e: { r: lastRow, c: column } });
  }
  sheet['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: FIRST_SLOT_ROW + SLOT_COUNT, c: 7 } });

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Weekly Schedule');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}

/**
 * A db.respond for importTimetable: terms and existing entries go through the WHERE clause the
 * importer sends. Term rows need id, batch_id, year, batch_year, term_number, start_date, end_date.
 * Existing entries need building_id, valid_from and valid_to as well as their timetable columns.
 */
export function respondForImport({ rooms, terms, existing = [] }) {
  return (sql, params) => {
    if (/FROM rooms WHERE building_id/.test(sql)) return { rows: rooms };
    if (/FROM terms t/.test(sql)) return { rows: selectWhere(sql, params, terms) };
    if (/FROM timetable_entries te/.test(sql)) return { rows: selectWhere(sql, params, existing) };
    if (/RETURNING id/.test(sql)) return { rows: [{ id: 1 }] };
    return null;
  };
}
