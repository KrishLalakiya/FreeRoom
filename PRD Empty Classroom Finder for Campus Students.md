# PRD: Empty Classroom Finder for Campus Students

Oct 12, 2026 · @Krish

## 1. Overview

**FreeRoom** (working name) tells students which classrooms are empty right now and exactly how long each will stay empty, so they can study there when the library is full.

**Problem.** The library has limited seats. Students who miss out wander between buildings, settle into a room, and get pushed out when a lecture or event starts. Nobody publishes a live view of which rooms are free, and the timetable is scattered across departments, PDFs and notice boards.

**Solution.** FreeRoom combines the class timetable and one-off events into a single schedule per room. From that schedule it computes, for any moment, whether a room is free and until when. A student sees a ranked list of rooms that are free for at least as long as they plan to study.

**Why this should exist as software.**

- The answer changes minute to minute: it depends on the current time, the day's timetable, and events added or cancelled that day.
- The core value is a computation (merge schedules, find gaps, filter by duration), which a static notice board or PDF cannot do.
- Free time is only useful if it is certain, so the data needs a single source of truth with corrections and cancellations flowing in quickly.

## 2. Target users

The primary user is a college student looking for a quiet place to study. A secondary role keeps the schedule data accurate.

| Role | Who | What they need | Access |
| --- | --- | --- | --- |
| Student | Any enrolled student | See free rooms now, how long they stay free, and where they are | Sign in with Google (college account) |
| Schedule admin | Timetable coordinator or a trusted student volunteer | Upload timetables, add or cancel events, fix wrong data | Admin role, restricted routes |

**Primary persona.** Aisha, second-year student, has a 2-hour gap between lectures. The library is full. She opens FreeRoom, sees three rooms in her building free for the next 2 hours or more, and walks to the nearest one.

## 3. Goals, non-goals and success metrics

The goal is that a student can find a room that is certain to stay free for their study window in under 10 seconds.

**Goals**

- Show every room that is free now, with the exact time it becomes occupied.
- Let students search by a future window (for example, 3 PM to 5 PM) and a minimum duration.
- Keep the schedule accurate through admin uploads, event changes and student reports.

**Non-goals (v1)**

- Booking or reserving rooms. FreeRoom only shows what is empty; it does not hold a room for anyone.
- Indoor navigation or live occupancy sensing.
- Support for multiple campuses.

**Success metrics**

| Metric | Target |
| --- | --- |
| Time from opening the app to seeing a suitable room | Under 10 seconds |
| Availability query response time (p95) | Under 300 ms |
| Schedule accuracy (student reports of a wrong "free" status) | Under 5% of sessions |
| Weekly active students in the pilot (one building or department) | 50+ |

## 4. Core workflows

The most important workflow is mapping every class and event to a room and time, so "empty" is certain rather than guessed.

**Workflow A: find a room that is free now (student)**

1. Student opens the app and signs in with Google.
2. App reads the current time and day, and asks for a minimum study duration (default 60 minutes).
3. Backend loads each room's schedule for today and finds rooms with no class or event right now.
4. For each free room, backend computes the free-until time, which is the start of the next class or event.
5. Rooms with less free time than the requested duration are dropped.
6. Student sees the remaining rooms sorted by longest free time, then by building.
7. Student opens a room to see its full day timeline.

**Workflow B: find a room for a future window (student)**

1. Student picks a date, a start time and an end time.
2. Backend checks that the window is valid (start before end, inside operating hours, not in the past).
3. Backend returns rooms with no overlap between the window and any class or event.
4. Student can filter by building, floor and capacity.

**Workflow C: report a wrong status (student)**

1. Student taps "Not actually empty" or "Actually free" on a room.
2. Backend records the report with a timestamp and the student's id, and ignores duplicates within 15 minutes.
3. Rooms with 3 or more reports are flagged for admin review, who correct the schedule. When 5 to 10 students agree, the status updates automatically as a temporary override.

**Workflow D: maintain the schedule (admin)**

1. Admin uploads the timetable (an .xlsx export of the Google Sheet), or adds a one-off event (exam, seminar, club meeting) with room, date and time.
2. Backend validates each class cell (room name maps to a known room, times valid, no clash with a different class in the same room).
3. Valid rows are saved; invalid rows are returned in an error report so the admin can fix and re-upload.
4. Cached availability for affected rooms is cleared, so students see the change immediately.
5. An admin can cancel a single occurrence of a class (for example, a lecture cancelled today) without deleting the whole timetable entry.

## 5. Functional requirements and availability logic

P0 items make the product work; P1 items make it good; P2 items are only built if time remains.

| ID | Requirement | Priority |
| --- | --- | --- |
| F1 | Sign in with Google (college account only); roles are student and admin | P0 |
| F2 | Admin uploads the weekly timetable as an .xlsx export of the Google Sheet, with cell-level validation | P0 |
| F3 | Admin creates, edits and cancels one-off events for a room and time range | P0 |
| F4 | "Free now" list showing free-until time for every room | P0 |
| F5 | Minimum-duration filter on the free-now list | P0 |
| F6 | Search by future date and time window | P0 |
| F7 | Room detail page with today's timeline of classes and events | P1 |
| F8 | Filter by building, floor and capacity | P1 |
| F9 | Cancel a single occurrence of a recurring class | P1 |
| F10 | Student reports of wrong status, with duplicate protection | P1 |
| F11 | Save favourite rooms or buildings | P2 |
| F12 | Notification when a saved room is about to be occupied (10 minutes before) | P2 |
| F13 | Offline view of the last loaded list | P2 |

**Availability engine (the core application logic)**

For a room and a query window, the engine does the following:

1. Expand recurring timetable entries into concrete occurrences for the requested date (for example, "Mon 10:00 to 11:00" becomes today's date and times).
2. Remove occurrences cancelled for that date.
3. Add one-off events for that date.
4. Sort all occurrences by start time and merge overlapping or touching ones into busy blocks.
5. The gaps between busy blocks (and between opening and closing hours) are the free intervals.
6. For "free now", find the free interval containing the current time; free-until is its end. For a window search, keep rooms with a free interval covering the whole window.

Two rules keep the answer safe: a room is treated as busy for a 5-minute buffer around each class (students leaving and arriving), and a day outside the uploaded timetable's dates is shown as "unknown", never as free; inside the timetable's dates, a room with no entries is free.

**Rooms in the pilot building**

| Floor | Room | Notes |
| --- | --- | --- |
| Ground | Classroom C | The only ground-floor room; the sheet writes it as "C groundfloor" (Academic Clubs) |
| 1st | 1A | The sheet writes it as "Classroom A 1st floor", also called Block A |
| 1st | 1B | The sheet writes it as "Classroom B 1st floor", also called Block B |
| 2nd | 2A | Fixed room |
| 2nd | 2B | Dividable: used whole as 2B, or split into two parts, 2B1 and 2B2 |
| 2nd | 2C | Fixed room; the sheet writes it as "Class C 2nd floor" |

**Dividable room (2B).** 2B1 and 2B2 are stored as child rooms of 2B, and the availability engine applies these rules:

- A class or event in 2B makes 2B1 and 2B2 busy too.
- A class or event in 2B1 makes 2B busy as a whole, but 2B2 stays free (and the other way round).
- 2B shows as free only when both 2B1 and 2B2 are free. If only one half is free, the app shows that half, for example "2B2 free until 3:00 PM".
- The upload's clash check uses the same rules, so a class in 2B and another in 2B1 at the same time is rejected.

**Timetable import (based on the current Google Sheet)**

The timetable is a Google Sheet whose weekly schedule tab is a grid: one row per 15-minute slot from 9:00 AM, one column per day (Monday to Saturday), repeated for Group A, Group B and Group C. Each class cell holds the course, group, teacher and room, for example "MERN - 2029, Grp A, (Mrinal), Classroom A 1st floor". The importer has to handle these features of that format:

- **Merged cells.** A class is a merged block of 15-minute rows, and its end time comes from the block's height (the Monday Group A MERN class is eight rows, 10:00 AM to 12:00 PM). A plain CSV export keeps only the first row of each block, so the admin uploads an .xlsx export, which keeps merged ranges. Later, the app can read the sheet directly through the Google Sheets API.
- **Inconsistent room names.** The same room appears as "Classroom A 1st floor", "Class A 1st floor" and "Classroom A ist floor". A room alias table maps each spelling to one room; names that are not mapped yet are listed for the admin to map once.
- **Repeated classes across groups.** Some classes, such as FDSA Repeat and Academic Clubs, appear in all three group grids. Identical entries (same course, teacher, room and time) are merged into one; different classes that overlap in a room are reported as clashes.
- **Cells that are not classes.** "Lunch" cells are ignored. Academic Clubs (5:30 to 8 PM, "C groundfloor") are imported as a recurring entry for that room.
- **Other tabs.** The course syllabus, exam and weightage tabs contain no room data and are ignored.

## 6. Data model

Data is relational and has clear links between rooms and their schedules, so a SQL database fits. Times are stored in UTC and converted to the campus time zone for display.

| Entity | Key fields | Notes |
| --- | --- | --- |
| User | id, email (unique), google\_id, role, created\_at | Role is student or admin |
| Building | id, name, opening\_time, closing\_time | Opening hours and closed days (holidays) bound free intervals |
| Room | id, building\_id, name, floor, capacity, parent\_room\_id (set for 2B1 and 2B2) | Unique on (building\_id, name); spelling variants from the timetable map to it through a room alias table (alias, room\_id) |
| TimetableEntry | id, room\_id, course\_name, day\_of\_week, start\_time, end\_time, valid\_from, valid\_to | Recurring weekly class |
| ScheduleException | id, timetable\_entry\_id, date, reason | Cancels one occurrence |
| Event | id, room\_id, title, start\_at, end\_at, created\_by | One-off exam, seminar or club event |
| StatusReport | id, room\_id, user\_id, reported\_status, created\_at | Used to flag wrong data |
| SavedRoom (P2) | user\_id, room\_id | Favourites for notifications |

**Constraints that protect data quality**

- Start time must be before end time on every entry.
- No two entries or events may overlap in the same room; the upload rejects the clashing row.
- Deleting a room is blocked while it has future schedule entries.
- Indexes on (room\_id, day\_of\_week) and (room\_id, start\_at) keep availability queries fast.

## 7. Architecture and tech stack

&#91;embedded content: architecture · 2 clients, 1 API, cache and database\]

Students and admins use the same React app; every request goes through the API, which checks the role, asks the cache first, and falls back to PostgreSQL on a miss. The timetable import writes straight to the database and clears the cache for the rooms it changed.

Each choice below is made because the application needs it, not to add technology.

| Layer | Choice | Why |
| --- | --- | --- |
| Frontend | React with Vite | Filters, duration and window inputs, and the room list all depend on shared state; mobile-first layout |
| Backend | Node.js with Express | One API for students and admins; simple middleware for auth, validation and rate limiting |
| Database | PostgreSQL | Rooms, schedules and events are relational; an exclusion constraint on room and time range can stop overlapping entries at the database level |
| Cache | In-memory cache in the API at first | Free-room results are short-lived; move to Redis only if the API runs on more than one server |
| Auth | Google Sign-In with JWT sessions | No passwords to store or reset; the API issues a JWT after verifying the Google token, with two roles |
| Hosting | Vercel or Netlify for the frontend; Render or Railway for the API and database | Free tiers are enough for a one-building pilot |

## 8. Failure handling and edge cases

The most dangerous failure is a wrong "free" answer, so the app prefers saying "unknown" over guessing.

| What can go wrong | How the app behaves |
| --- | --- |
| Invalid search input (end before start, past date, duration over opening hours) | Request is rejected with a 400 and a message naming the bad field; the UI highlights it |
| Timetable upload has bad cells (unknown room name, unreadable class cell, clashing classes) | Valid rows are not saved partially; the whole upload is rejected with a row-by-row error report, or the admin picks "save valid rows only" |
| Duplicate upload of the same timetable | Detected by room, day and time; duplicates are skipped and counted in the report |
| Date outside any uploaded timetable | Shown as "unknown" and excluded from "free" results |
| Class cancelled or moved the same day | Admin adds a schedule exception or event; the cache for that room is cleared immediately |
| Class runs over or students stay late | The 5-minute buffer absorbs small overruns; student reports flag larger problems |
| Student spams status reports | One report per user per room per 15 minutes; rooms with 3 or more reports are flagged for admin review; once 5 to 10 students report the same status (exact number set in config), the room's status updates automatically as a temporary override that expires on its own, so admins do not have to review every case |
| Unauthorized access (student calls an admin route, expired token) | 403 or 401 with no data returned; admin actions are checked on the server, not only hidden in the UI |
| Room or building not found | 404 with a clear message; the UI shows an empty state, not a crash |
| Database or cache failure | If the cache is down, queries go straight to the database; if the database is down, the app shows the last loaded list marked "may be outdated" |
| Device clock is wrong | The server's time is used for availability, never the device's |
| Day boundaries and holidays | Campus holidays are stored as closed days, so rooms are not shown as free on a day the campus is shut |

## 9. Non-functional requirements

| Area | Requirement |
| --- | --- |
| Authentication | Sign in with Google (OAuth 2.0); the server verifies the Google ID token and accepts only the college email domain, then issues its own short-lived JWT. If Google is unreachable, new logins fail with a clear message while existing sessions continue until their JWT expires |
| Authorization | Role check (student or admin) in server middleware on every admin route |
| Security | Secrets in environment variables only, never committed; input validation on all endpoints; rate limiting on login and report endpoints; CORS restricted to the frontend origin |
| Performance | Availability query p95 under 300 ms for one building, with room to grow to a full campus |
| Caching | Computed free-room results cached for 30 to 60 seconds; cache entries for a room are invalidated when its schedule changes |
| Reliability | App degrades to database queries if cache fails; health-check endpoint for the host |
| Usability | Mobile-first layout, since students will use it while walking; the main list fits one screen |
| Privacy | Store only email and role; status reports are not shown with the reporter's identity |
| Testing | Unit tests for the availability engine and timetable import validation; API tests for auth and admin routes |

## 10. Delivery plan: Git, docs, testing, deployment

The project goes from problem to product to a deployed app through small, reviewable steps, each committed on its own.

**Git practice**

- One feature per branch, merged into main; commits are small and use clear messages such as `feat: availability engine merges overlapping events`.
- `.env` is in `.gitignore`; a committed `.env.example` lists variable names with no values.
- Folder layout: `client/`, `server/`, `docs/`, plus a root README.

**README sections (matching the brief)**

Project name, problem statement, target users, solution, key features, tech stack, architecture, local setup, environment variables, deployment link.

**Testing plan**

- Unit tests: interval merging, free-until calculation, buffer rule, "unknown" status, timetable import (merged cells, room aliases, duplicate classes across groups).
- API tests: login, role-protected routes, invalid search windows, duplicate uploads.
- Manual test with real timetable data from one department before the pilot.

**Build order**

1. Set up the repo.
2. Build the database schema and seed data for one building.
3. Build auth and roles.
4. Build timetable import (.xlsx export of the Google Sheet) with validation.
5. Build one-off events.
6. Build cancellations of single class occurrences.
7. Build the availability engine with unit tests.
8. Build the student free-now list with the duration filter.
9. Build the future window search.
10. Build the room timeline.
11. Add status reports.
12. Add caching.
13. Add rate limiting.
14. Deploy the app.
15. Load real data and run a pilot with a small group of students.
16. Fix what the pilot students report.
17. Write the README and finalise documentation.

**Deployment.** Frontend on a static host (Vercel or Netlify), backend and database on a managed host (Render, Railway or similar), environment variables set in the host dashboard. The live URL goes in the README.

## 11. Risks, open questions and future scope

The biggest risk is data: if the timetable is incomplete or stale, the product gives wrong answers and students stop trusting it.

| Risk | Mitigation |
| --- | --- |
| Timetable data is hard to get or in messy formats | Start with one building; import the current Google Sheet timetable with clear error reports; accept manual entry for the pilot |
| Unscheduled use (extra classes, makeup lectures, informal meetings) | Show "free" as "free per schedule"; student reports and admin events cover gaps |
| Students entering a room and disturbing a class that was not in the schedule | Buffer rule, "unknown" status, and a visible last-updated time |
| Nobody maintains the data after launch | Name a schedule admin early; keep the upload flow quick |

**Open questions**

- [x] Timetable format: a Google Sheet with a weekly grid per batch group (see "Timetable import" in section 5).
- [x] Room access: any student can enter any empty classroom, so v1 has no room restrictions.
- [x] Pilot scope: one building, using the classrooms in the current timetable.
- [x] Platform: web-only for now, as a mobile-first responsive site with no installable app.
- [ ] What are the building's opening and closing hours? The sheet runs from 9:00 AM to "after 7:30 PM", and Academic Clubs run until 8 PM.
- [x] Timetable changes: yes, it can change during the term, and the admin uploads the new .xlsx export whenever it does.
- [x] Rooms outside the timetable: none, so every room students can use appears in the timetable.
- [x] Rooms: ground floor has Classroom C; 1st floor has 1A and 1B; 2nd floor has 2A and 2C (fixed) and 2B (dividable into 2B1 and 2B2).

**Future scope**

- Notifications before a saved room is about to be occupied.
- Integration with the college timetable system for automatic sync.
- Library seat count shown alongside free rooms, so students can choose between them.
- Analytics on peak study times and which buildings are most used.
