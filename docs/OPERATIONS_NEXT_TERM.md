# Operations Runbook: Next-Term Timetable Upload (C15)

This guide documents the operational procedures for uploading future academic terms into FreeRoom when new terms start (e.g. **Batch 2029 Term 6**, **Batch 2028 Term 10**, and **Batch 2030 Term 1** once introduced).

---

## 1. Overview of Next-Term Timetable Architecture

- **Independent Batch Timetables:** Each cohort/batch has its own `.xlsx` syllabus/timetable sheet.
- **Term Coverage:** Every timetable entry belongs to one `terms` record (`batch_id`, `semester_number`, `term_number`, `start_date`, `end_date`).
- **Date Continuity:** When Term $N$ ends (e.g., Oct 28, 2026), Term $N+1$ begins (e.g., Oct 29, 2026).
- **Unknown Status Outside Terms (C5):** Dates not covered by any active term return `"unknown"` availability status, ensuring students never see false free rooms during term transition gaps.
- **Historical Retention:** Previous term records and timetable entries are preserved in the database for history and analytics.

---

## 2. Pre-Upload Checklist

Before uploading a new term's spreadsheet:

1. **Verify Sheet Format:** Ensure the file is an `.xlsx` workbook.
2. **Confirm Column Headers:** The sheet should contain day-of-week sections (Monday through Friday/Saturday) and room column headers (e.g., `Classroom A (1st floor)`, `Classroom B (1st floor)`, `Classroom C (Ground floor)`, etc.).
3. **Check Room Aliases:** If the faculty or scheduling coordinator used new room naming conventions, verify or add aliases in Admin UI (`/admin/timetable`) under "Room Aliases".
4. **Determine Term Dates:** Obtain the official term start date and end date from the academic calendar (e.g., `2026-10-29` to `2027-01-31`).

---

## 3. Upload Method A: Admin Web UI (Recommended)

1. Navigate to `http://<host>:5173/admin/timetable` and log in with an administrator account.
2. Under **"Academic Terms"**, click **"Create Term"**:
   - **Batch Year:** e.g., `2029` (or `2030` for incoming cohorts)
   - **Semester:** e.g., `3`
   - **Term Number:** e.g., `6`
   - **Start Date:** `2026-10-29`
   - **End Date:** `2027-01-31`
   - Click **Save Term**.
3. Under **"Upload Timetable"**:
   - Select the newly created term from the **Term** dropdown: `Batch 2029 (Term 6)`.
   - Choose the exported `.xlsx` file.
   - Click **Upload & Validate**.
4. **Review Upload Report:**
   - **Saved Rows:** Confirms valid timetable entries stored.
   - **Duplicates:** Rows already present are automatically skipped.
   - **Warnings:** Cross-batch overlaps (e.g., another batch using the room at the same time) are surfaced as warnings.
   - **Unmapped Rooms:** If any unknown room names are reported, add them as aliases and re-upload.

---

## 4. Upload Method B: Operations CLI Script

For automated or headless server environments, use the built-in upload CLI script:

```bash
# Example: Uploading Batch 2029 Term 6
node server/src/scripts/uploadNextTerm.js \
  --file "path/to/SST 2029 Batch Term 6 Syllabus.xlsx" \
  --batch 2029 \
  --semester 3 \
  --term 6 \
  --start 2026-10-29 \
  --end 2027-01-31

# Example: Uploading Batch 2028 Term 10
node server/src/scripts/uploadNextTerm.js \
  --file "path/to/SST 2028 Batch Term 10 Syllabus.xlsx" \
  --batch 2028 \
  --semester 5 \
  --term 10 \
  --start 2026-10-29 \
  --end 2027-01-31

# Example: Uploading Batch 2030 Term 1 (New Batch)
node server/src/scripts/uploadNextTerm.js \
  --file "path/to/SST 2030 Batch Term 1 Syllabus.xlsx" \
  --batch 2030 \
  --semester 1 \
  --term 1 \
  --start 2026-10-29 \
  --end 2027-01-31
```

---

## 5. Post-Upload Verification

After uploading, run the following verification steps:

1. **Verify Term Linkage:**
   ```sql
   SELECT t.term_number, b.year, COUNT(te.id) as entries_count
   FROM timetable_entries te
   JOIN terms t ON te.term_id = t.id
   JOIN batches b ON t.batch_id = b.id
   GROUP BY t.term_number, b.year
   ORDER BY b.year DESC, t.term_number DESC;
   ```
2. **Verify Group Associations:**
   ```sql
   SELECT te.id, te.course_name, ARRAY_AGG(g.name) as groups
   FROM timetable_entries te
   JOIN timetable_entry_groups teg ON teg.timetable_entry_id = te.id
   JOIN groups g ON teg.group_id = g.id
   GROUP BY te.id, te.course_name
   LIMIT 10;
   ```
3. **Verify Cache Invalidation:**
   - Any term creation or timetable import immediately flushes the in-memory availability cache (`C10`).
   - Querying `GET /api/rooms/free-now` will immediately compute fresh availability reflecting the new timetable.
4. **Student App Spot-Check:**
   - Search for free rooms on the first day of the new term (`http://<host>:5173/plan`).
   - Verify that classroom timelines reflect the new subjects, instructors, and group badges.
