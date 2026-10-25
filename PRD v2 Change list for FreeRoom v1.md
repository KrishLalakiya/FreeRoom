# PRD v2: Change list for FreeRoom v1

@Krish

## 1. Baseline and what we now know

FreeRoom v1 is built to PRD v1, so this document lists only the changes to make in the current project, not a rewrite. It assumes the code matches PRD v1.

What we now know about the college:

- **Holidays and breaks do not close rooms.** The college is mostly open on holidays with no room restriction.
- **Class times come only from the term timetable.** A room is busy only when the term timetable has a class for it. The building is open 6 AM to 10 PM, and those hours are the only limit on free time.
- **Exams are the one thing that closes rooms.** During exam dates students may not use the exam rooms, the exam floors, or sometimes the whole college. Exam dates are never fixed, so closures must be entered and edited by an admin, not hard-coded.
- **The year is split into terms.** There are 2 semesters of 6 months, each with 2 terms. Batch 2029 is in Term 5 and batch 2028 is in Term 9, each with its own timetable sheet, and batch 2030 will be added later. The next terms start around Oct 29, 2026 (tentative), each with a new timetable.

## 2. Change list

There are 22 changes, 16 of them P0. The core of v2 is terms and exam closures; the rest removes v1 assumptions that turned out wrong.

| ID | Change | Area | Priority | Replaces in v1 |
| --- | --- | --- | --- | --- |
| C1 | Set building hours to 6 AM to 10 PM as a setting, not hard-coded; free time is bounded by these hours, and after a room's last class the app shows "free until 10 PM" | Engine, data model, tests | P0 | Opening and closing times in the v1 seed data |
| C2 | Remove the rule that holidays are closed days; holidays and breaks no longer close rooms | Engine, data model, docs | P0 | "Closed days (holidays)" on Building; the holidays row in failure handling |
| C3 | Add a Term record linked to a batch (semester number, term number, start date, end date); every timetable entry belongs to one term | Data model, import | P0 | Timetable entries with only valid-from and valid-to dates |
| C4 | Timetable upload asks which batch and term it is for; each batch has its own sheet, so a new term or a new batch is a new upload, and old terms are kept for history | Import, admin UI | P0 | Single upload with no term |
| C5 | For dates outside any term, show rooms as "unknown", never as free | Engine, student UI | P0 | The "unknown" rule, extended to dates with no timetable |
| C6 | Add a Closure record: scope (room, floor or whole building), date, optional time range, reason (exam), note | Data model | P0 | New; nothing in v1 |
| C7 | Engine treats a closure as blocking and ranks it above the timetable; a floor closure covers every room on that floor, and a 2B closure covers 2B1 and 2B2 | Engine, tests | P0 | Availability logic |
| C8 | Admin closures page: add one day or a date range, pick the scope, edit or delete, see upcoming closures; confirm before a whole-building closure | Admin UI, API | P0 | New |
| C9 | Student app shows a banner on closure days and lists closed rooms greyed out with the reason, never in the free list | Student UI | P1 | Free-now list, room detail |
| C10 | Closure and term changes clear the cache for the affected rooms | Cache, API | P0 | Cache clearing on schedule change |
| C11 | New failure handling: closure ending before it starts, closure for a missing room or floor, overlapping terms, timetable dates outside its term | API, validation | P1 | Failure handling table |
| C12 | No-class days: admin marks holiday or break dates so timetable classes are skipped (confirmed: classes do not run on holidays and breaks) | Data model, engine, admin UI | P1 | New |
| C13 | Later, only if wanted: prefill closures and no-class days from the academic calendar sheet (for now the admin enters closures) | Import | P2 | New |
| C14 | Update tests, README (features, data model, architecture) and the architecture diagram, which now needs terms and closures in the database | Tests, docs | P0 | README and diagram |
| C15 | Upload each batch's next-term timetable when its term starts (batch 2029 Term 6, batch 2028 Term 10, and batch 2030 once added) | Operations | P0 | Timetable upload |
| C16 | Set room seat counts: 200 for each room, 100 each for 2B1 and 2B2 (2B as a whole stays 200); show seats on room cards and use them in the capacity filter | Data, student UI | P0 | Capacity field with no values |
| C17 | Rebuild the timetable data model around batch, term, group, subject and instructor, so every class says who it is for (section 6) | Data model, migration | P0 | Flat timetable entry with a course name and no group |
| C18 | Importer reads batch, group, subject, instructor, room and class type (class, lab or club) from each cell and saves them as linked records | Import | P0 | Importer that saved course name and room only |
| C19 | Room timeline in the student app lists subject, group and instructor for each class | Student UI | P1 | Room timeline with times only |
| C20 | My group view: a student picks batch and group, sees that group's classes and gaps, and which rooms are free during the gaps | Student UI | P2 | New |
| C21 | Importer copes with the differences between the 2028 and 2029 sheets: combined groups (A+B), classes with no group or instructor, room names written many ways, and unnamed Lab cells that belong to the class above | Import | P0 | Importer built for one sheet layout |
| C22 | Cross-batch checks: overlapping classes from different batches in one room become warnings to the admin instead of rejections, and the same club event appearing in two sheets is saved once | Import, validation | P0 | v1 rule that rejects any overlap in a room |

## 3. Rules for the new parts

For any date, the engine now answers from the term timetable first and then applies exam closures on top.

**Terms**

- A term belongs to a batch and has a semester number, a term number (for example batch 2029, semester 3, term 5), a start date and an end date. Terms of the same batch cannot overlap.
- Each timetable entry belongs to one term and repeats weekly inside that term's dates.
- For a given date the app uses the term of each batch that contains it. If no term contains the date, rooms show as "unknown".

**Closure fields**

| Field | Meaning |
| --- | --- |
| scope | Room, floor or whole building |
| room or floor | Which room or floor, when the scope is not the whole building |
| date from, date to | One day, or a range for a multi-day exam period |
| start time, end time | Optional; blank means the whole day |
| reason | Exam |
| note | Free text for the admin |
| created by | The admin who entered it |

**How the engine decides, per room and date**

1. Find the term that contains the date. If there is none, the status is "unknown".
2. Build busy blocks from that term's timetable and one-off events, minus cancelled occurrences, using the same 5-minute buffer and 2B, 2B1, 2B2 rules as v1.
3. Add every closure that applies to the room (its own, its floor's, or the whole building's) as a busy block for the closure's time range, or for the whole day.
4. Merge the busy blocks and find the gaps. The first gap starts at 6 AM and the last gap ends at 10 PM, the building's hours.
5. If a closure covers the room for the whole query window, return "closed" with its reason instead of "free".

**New failure cases**

- A closure that ends before it starts is rejected.
- A closure naming a room or floor that does not exist is rejected.
- Overlapping closures are merged, not stored twice.
- A closure dated in the past is allowed but flagged, so the admin can correct records.
- Two terms of the same batch with overlapping dates are rejected.
- A timetable row outside its term's dates is rejected with a row error.
- A date between two terms shows rooms as "unknown" and never as free.

## 4. Suggested build order for v2

Build the removals first, then terms, then closures, with one commit per step.

1. Create a branch for v2.
2. Set building hours to 6 AM to 10 PM and update the engine's tests (C1).
3. Set room seat counts: 200 for each room, 100 each for 2B1 and 2B2 (C16).
4. Remove the holiday closed-day rule from the engine and the data model (C2).
5. Add the Batch, Term, Group, Subject and Instructor tables, plus the link between a timetable entry and its groups, with migrations (C3, C17).
6. Make timetable upload ask for the batch and term and save entries under them (C4).
7. Teach the importer to read batch, group, subject, instructor and class type from each cell (C18).
8. Teach the importer the differences between the 2028 and 2029 sheets (C21).
9. Add the cross-batch overlap warnings and the merging of repeated club events (C22).
10. Clear the v1 timetable entries and re-import the 2029 Term 5 sheet and the 2028 Term 9 sheet.
11. Show rooms as "unknown" for dates outside any term (C5).
12. Add the Closure table and its migration (C6).
13. Teach the engine to apply closures, with unit tests (C7).
14. Build the admin closures page (C8).
15. Build no-class days for holidays and breaks (C12).
16. Show the closure banner and greyed-out closed rooms in the student app (C9).
17. Show subject, group and instructor on the room timeline (C19).
18. Clear the cache when a term, closure or no-class day changes (C10).
19. Add the new validation and failure handling (C11).
20. Update the README, tests and architecture diagram (C14).
21. Upload each batch's next-term timetable when its term starts (C15).
22. Later, optional: the My group view (C20) and prefilling closures from the calendar sheet (C13).

## 5. Open questions

One question is still open: the layout of the future 2030 sheet.

- [x] On holidays and breaks classes do not run and classrooms are empty, so C12 is needed.
- [x] Mid-term days for Batch 2030 only: rooms are off-limits to everyone, so closures apply to all students and need no batch field.
- [x] Exam closures are entered by the admin by hand; importing them from the academic calendar sheet (C13) is left for later.
- [x] Other batches use these rooms: batch 2028 (Term 9) and batch 2029 (Term 5) now, and batch 2030 will be added later. Each batch has its own sheet, uploaded separately.
- [ ] Will the 2030 sheet use the same layout as the 2028 and 2029 sheets?\
yes

## 6. Timetable data model

Every class should say who it is for, so v2 replaces the flat timetable entry with linked records. The path from the college's side is: Batch 2029, then Semester 3 / Term 5, then Group A, B or C, then the subject (MERN, CN, CML, FDSA Repeat).

| Entity | Key fields | Example from the sheet |
| --- | --- | --- |
| Batch | id, year | 2029 |
| Term | id, batch, semester number, term number, start date, end date | Batch 2029, semester 3, term 5 |
| Group | id, batch, name | Group A |
| Subject | id, name, short code | MERN, CN, CML, FDSA Repeat |
| Instructor | id, name | Mrinal, Ayush, Chitwan, Kshitij, Utkarsh, Deepanshi |
| Timetable entry | id, term, subject, instructor, room, day of week, start time, end time, entry type (class, lab or club); linked to zero, one or several groups | MERN, Group A, Mrinal, room 1A |
| Room | id, building, name, floor, seats, parent room | 2B1: 100 seats, part of 2B |

How the new model works:

- A class can have one group, several groups (the 2028 sheet has C++ for Group A+B together) or none (a class for the whole batch). Subject and instructor can be empty too: the 2028 sheet has no instructor names, and Academic Clubs has no subject.
- When the word LAB appears in a cell's title or group line (for example "MERN - 2029 Grp A LAB" or "FDSA Repeat LAB"), the entry is saved with entry type lab and the same subject as the lecture. MERN and MERN lab are one subject, and the app shows the lab as "MERN (Lab)".
- Lunch cells are skipped, because lunch does not use a room.
- Groups stay with their batch from term to term (confirmed), and a subject that repeats in a later term is reused.
- Batches 2028 and 2029 both use the building, and batch 2030 will join. Each batch has its own terms and uploads, and the engine merges all their entries when it looks for busy time.
- Migration: the v1 entries have no group or instructor, so the simplest route is to clear them and re-import the Term 5 sheet with the new importer.

**Differences between the 2028 and 2029 sheets**

- The 2028 sheet has Groups A and B; the 2029 sheet has A, B and C.
- Some 2028 classes name no group (Advance Graph Algorithms, Financial Market and Instruments, Network Architecture), so they belong to the whole batch.
- Room names are written more ways: "Class C Ground floor", "class C Ground floor", "Class B 1st floor", "Class A 2nd floor", and FDE cells write the room in brackets, such as "(Classroom C, 2nd Floor)". The alias table maps them all to Classroom C (ground), 1B, 2A and 2C.
- Cells that say only "Lab" belong to the class above them in the same column. The importer copies that class's subject, group and room, saves the entry as a lab, and uses the Lab cell's own start and end times. If there is no class above it, the cell is skipped and listed in the warnings for the admin.
- Academic Clubs appear in the ground-floor Classroom C in both sheets. When the same club event shows up in both at the same time and place, it is saved once.
