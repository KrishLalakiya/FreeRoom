#!/usr/bin/env node

/**
 * CLI Tool for Next-Term Timetable Upload (PRD v2 C15, Step 21).
 *
 * Usage:
 *   node server/src/scripts/uploadNextTerm.js \
 *     --file "path/to/SST 2029 Batch Term 6 Syllabus.xlsx" \
 *     --batch 2029 \
 *     --semester 3 \
 *     --term 6 \
 *     --start 2026-10-29 \
 *     --end 2027-01-31
 */

import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { getClient, query } from '../src/config/db.js';
import { importTimetable } from '../src/services/timetableImport.js';
import { clearAvailabilityCache } from '../src/services/cache.js';
import { isValidDateStr, toDateStr } from '../src/utils/timezone.js';

dotenv.config();

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    file: null,
    batchYear: null,
    semesterNumber: null,
    termNumber: null,
    startDate: null,
    endDate: null,
    saveValidRowsOnly: false,
    dryRun: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--file' && args[i + 1]) options.file = args[++i];
    else if (arg === '--batch' && args[i + 1]) options.batchYear = parseInt(args[++i], 10);
    else if (arg === '--semester' && args[i + 1]) options.semesterNumber = parseInt(args[++i], 10);
    else if (arg === '--term' && args[i + 1]) options.termNumber = parseInt(args[++i], 10);
    else if (arg === '--start' && args[i + 1]) options.startDate = args[++i];
    else if (arg === '--end' && args[i + 1]) options.endDate = args[++i];
    else if (arg === '--saveValidRowsOnly') options.saveValidRowsOnly = true;
    else if (arg === '--dry-run' || arg === '--dryRun') options.dryRun = true;
  }

  return options;
}

async function main() {
  const options = parseArgs();

  if (!options.file || !options.batchYear || !options.termNumber) {
    console.error('❌ Error: Missing required arguments.');
    console.error('Usage: node uploadNextTerm.js --file <path> --batch <year> --term <num> [--semester <num>] [--start <YYYY-MM-DD>] [--end <YYYY-MM-DD>]');
    process.exit(1);
  }

  const resolvedFilePath = path.resolve(process.cwd(), options.file);
  if (!fs.existsSync(resolvedFilePath)) {
    console.error(`❌ File not found: ${resolvedFilePath}`);
    process.exit(1);
  }

  const client = await getClient();

  try {
    console.log('======================================================');
    console.log(`🚀 Starting Next-Term Timetable Upload (C15)`);
    console.log(`   Batch: ${options.batchYear} | Term: ${options.termNumber}`);
    console.log(`   File: ${resolvedFilePath}`);
    console.log('======================================================');

    // 1. Ensure Batch exists
    let batchRes = await client.query('SELECT id FROM batches WHERE year = $1', [options.batchYear]);
    let batchId;
    if (batchRes.rows.length === 0) {
      if (options.dryRun) {
        batchId = 999999;
        console.log(`🔍 [DRY RUN] Would create new batch: Year ${options.batchYear}`);
      } else {
        const newBatch = await client.query('INSERT INTO batches (year) VALUES ($1) RETURNING id', [options.batchYear]);
        batchId = newBatch.rows[0].id;
        console.log(`✨ Created new batch: Year ${options.batchYear} (ID: ${batchId})`);
      }
    } else {
      batchId = batchRes.rows[0].id;
      console.log(`✔️ Using existing batch: Year ${options.batchYear} (ID: ${batchId})`);
    }

    // 2. Ensure Term exists or update dates
    let termRes = await client.query('SELECT * FROM terms WHERE batch_id = $1 AND term_number = $2', [batchId, options.termNumber]);
    let termId;

    const startDate = options.startDate || (termRes.rows[0]?.start_date ? toDateStr(termRes.rows[0].start_date) : '2026-10-29');
    const endDate = options.endDate || (termRes.rows[0]?.end_date ? toDateStr(termRes.rows[0].end_date) : '2027-01-31');
    const semesterNumber = options.semesterNumber || termRes.rows[0]?.semester_number || 1;

    if (!isValidDateStr(startDate) || !isValidDateStr(endDate)) {
      throw new Error(`Invalid start (${startDate}) or end (${endDate}) date.`);
    }

    if (termRes.rows.length === 0) {
      if (options.dryRun) {
        termId = 999999;
        console.log(`🔍 [DRY RUN] Would create new term: Term ${options.termNumber} (${startDate} to ${endDate})`);
      } else {
        const newTerm = await client.query(`
          INSERT INTO terms (batch_id, semester_number, term_number, start_date, end_date)
          VALUES ($1, $2, $3, $4, $5)
          RETURNING id
        `, [batchId, semesterNumber, options.termNumber, startDate, endDate]);
        termId = newTerm.rows[0].id;
        console.log(`✨ Created new term: Term ${options.termNumber} (${startDate} to ${endDate}) (ID: ${termId})`);
      }
    } else {
      termId = termRes.rows[0].id;
      if (options.dryRun) {
        console.log(`🔍 [DRY RUN] Would update term: Term ${options.termNumber} (${startDate} to ${endDate}) (ID: ${termId})`);
      } else {
        await client.query(`
          UPDATE terms
          SET semester_number = $1, start_date = $2, end_date = $3
          WHERE id = $4
        `, [semesterNumber, startDate, endDate, termId]);
        console.log(`✔️ Updated term: Term ${options.termNumber} (${startDate} to ${endDate}) (ID: ${termId})`);
      }
    }

    // 3. Import Timetable
    console.log(`\n📥 Parsing and importing timetable from ${path.basename(resolvedFilePath)}...`);
    const report = await importTimetable(resolvedFilePath, {
      termId,
      batchYear: options.batchYear,
      termNumber: options.termNumber,
      validFrom: startDate,
      validTo: endDate,
      saveValidRowsOnly: options.saveValidRowsOnly,
      dryRun: options.dryRun,
    });

    console.log('\n📊 Import Report:');
    console.log(`   Committed:        ${report.committed ? 'YES ✅' : (report.dryRun ? 'DRY RUN (SKIPPED) 🔍' : 'NO ❌')}`);
    console.log(`   Parsed Classes:   ${report.parsedCount}`);
    console.log(`   Saved Rows:       ${report.savedCount}`);
    console.log(`   Duplicates:       ${report.duplicateCount}`);
    console.log(`   Warnings:         ${report.warnings?.length || 0}`);
    console.log(`   Unmapped Rooms:   ${report.unmappedRooms?.length || 0}`);
    console.log(`   Errors:           ${report.errors?.length || 0}`);

    if (report.warnings?.length > 0) {
      console.log('\n⚠️ Warnings (e.g. cross-batch overlaps):');
      for (const w of report.warnings.slice(0, 5)) {
        console.log(`   - Row ${w.sheetRow} [${w.dayOfWeek}]: ${w.reason}`);
      }
      if (report.warnings.length > 5) {
        console.log(`   ... and ${report.warnings.length - 5} more`);
      }
    }

    if (report.errors?.length > 0) {
      console.error('\n❌ Errors:');
      for (const e of report.errors.slice(0, 5)) {
        console.error(`   - Row ${e.sheetRow} [${e.dayOfWeek || e.column}]: ${e.reason || e.error}`);
      }
    }

    if (!report.dryRun) {
      // 4. Invalidate Cache
      clearAvailabilityCache();
      console.log('\n⚡ Availability cache cleared for fresh queries.');
    } else {
      console.log('\n🔍 Dry run completed successfully without writing to database.');
    }

    console.log('\n✅ Next-Term Timetable operations upload completed successfully.');
    process.exit((report.committed || report.dryRun) ? 0 : 1);
  } catch (err) {
    console.error('\n💥 Fatal upload error:', err);
    process.exit(1);
  } finally {
    client.release();
  }
}

main();
