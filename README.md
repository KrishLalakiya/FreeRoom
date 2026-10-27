# FreeRoom

FreeRoom shows students which classrooms in their college building are empty right now, which are free later today or tomorrow, and for how long. It also shows each student's own class timetable with the free rooms during their gaps.

## Problem Statement

Students waste time walking between classrooms to find an empty room to study or hold a group discussion. The library has limited seats, and the timetable for each batch and group is kept in a spreadsheet that students cannot easily check. There is no single place to see which rooms are free, when they become busy again, and which rooms are free during a student's own gap between classes.

## Target Users

- **Students** of one college building (pilot: Batch 2028 Term 9 and Batch 2029 Term 5, with Batch 2030 to follow). They want to find a free room quickly, between classes or for a specific time later.
- **Admins** (college staff) who keep the timetable up to date. They import the weekly timetable, cancel single classes, add one-off events and enter exam closures.

## Solution

FreeRoom turns the weekly timetable spreadsheet into a live availability view. The timetable is imported once per term, and closures and one-off events are entered by admins. The app then works out, for every room and every moment in building hours, whether the room is busy or free, and for how long. Students see this on three pages, without signing in.

## Key Features

**Students (no sign-in needed to browse)**

- **Free now:** all rooms that are free at this moment, with the time each one stays free. Filter by the minimum free time (any, 30 minutes, 1 hour, 2 hours).
- **Find a room:** pick a date (defaults to the next day), a time window and a floor to see free rooms. Open any room to see its full day: the batch, group, subject and teacher in each booked slot, and the free gaps.
- **My group:** pick a day and see your batch and group's classes, with the free rooms available during each gap. Your batch and group are asked for on your first visit and remembered on that device.
- **Next day timetable:** the rooms that open in the morning and what is booked in them.
- **Sign in with Google (optional):** signed-in students keep their batch, group and favourite rooms across devices.

**Admins (sign-in and admin role required)**

- Import a weekly timetable from an `.xlsx` export, with validation and room name matching.
- Schedule one-off events (seminars, exams, club meetings) with clash detection.
- Cancel a single class on a given date to free its room.
- Add holidays and breaks, and exam or room closures for a room, a floor or the whole building.
- View the action log of every change an admin has made.

## Deployment

- **Live app:** [https://freeroom-nine.vercel.app/](https://freeroom-nine.vercel.app/)
- **Demo video:** [https://youtu.be/dG45sPS2R54 ](https://youtu.be/dG45sPS2R54)
- **Hosting:** 
  - **Client (Frontend):** Vercel
  - **Server (Backend API):** Render Web Service
  - **Database:** Supabase

## Tech Stack

- **Frontend:** React 19 (`^19.3.1`) built with Vite 8 (`^8.3.4`), React Router v7 (`^7.18.4`), Axios (`^1.20.0`), React Hot Toast (`^2.6.1`), and React Icons (`^5.7.0`)
- **Backend:** Node.js (v18+) with Express (`^4.21.0`), ES Modules, CORS (`^2.8.5`), and Express Rate Limit (`^7.4.1`)
- **Database:** PostgreSQL (v14+) accessed via `pg` (`node-postgres ^8.13.0`) with connection pooling and relational migrations
- **Authentication:** Google OAuth 2.0 via `@react-oauth/google` and `google-auth-library` (`^9.14.1`), JSON Web Tokens (`jsonwebtoken ^9.0.2`), and environment-backed credentials authentication for administrators
- **Timetable import:** SheetJS (`xlsx ^0.18.5`) for Excel spreadsheet parsing, with `multer` (`^1.4.5-lts.1`) for multipart file uploads
- **Styling:** Vanilla CSS with custom design tokens supporting three theme modes (Light, Dark, and Darker)

## Architecture

```text
Browser (React)
   │  HTTPS, JSON
   ▼
Express API
   ├── Auth: Google sign-in, JWT, admin role check on every admin route
   ├── Timetable import: .xlsx → validate → batch, term, group, subject, room entries
   ├── Availability engine
   └── Admin actions: closures, cancellations, one-off events, action log
   │
   ▼
PostgreSQL
   batch · term · group · subject · instructor · timetable entry · room · closure · no-class day · admin action
```

**Availability engine.** For a given room and moment, the engine:

1. Finds the term that covers the date.
2. Collects the room's busy blocks from the timetable for that weekday.
3. Adds closure blocks (exams, maintenance) and one-off events, which override the timetable.
4. Subtracts the busy blocks from building hours (6:00 am to 10:00 pm) to get free gaps, and reports each room as free or busy with the time it stays that way.

**Rooms.** Ground floor: C. First floor: 1A, 1B. Second floor: 2A, 2C, and 2B, which can be split into 2B1 and 2B2 (100 seats each). 2B is free only when both halves are free.

**Errors handled.** Invalid timetable rows are reported at import, and the admin can import only valid rows. Failed network requests show a retry message. Admin routes return 403 for non-admin accounts. A corrupt or missing saved batch and group makes the batch picker appear before the schedule loads.

## Originality and Credits

- **React 19 & Vite 8:** For component-driven architecture, fast Hot Module Replacement (HMR), and optimized bundle compilation.
- **SheetJS (`xlsx`):** For client-side and server-side parsing of raw Excel timetable workbooks into relational data structures.
- **PostgreSQL & `pg`:** High-performance relational storage for complex term schedules, partition hierarchies, and ACID-compliant transactional updates.
- **Google Identity Services & `@react-oauth/google`:** Secure, modern OAuth 2.0 sign-in without requiring third-party redirect popups.
- **Heroicons / React Icons:** Clean, accessible SVG iconography tailored for schedule navigation.
- **React Hot Toast:** Accessible micro-notifications for feedback on schedule operations, admin actions, and authentication.
- **Availability Interval Algorithm:** Developed specifically for FreeRoom to perform dynamic interval subtraction against building operating hours, factoring in partition overlaps, exam closures, and one-off events.

## Status

- **Working:**
  - Live "Free now" room occupancy status with interval countdowns and duration filters.
  - "Find a room" future time-window query with floor filters and full-day room timeline breakdowns.
  - "My group" personalised schedule with automatic gap detection and vacant room recommendations.
  - Room 2B partition hierarchy: smart synchronization between parent room 2B (200 seats) and sub-rooms 2B1/2B2 (100 seats each).
  - Guest browsing: students browse all screens without requiring an account.
  - Google OAuth sign-in and cross-device sync for saved batch, group, and settings.
  - Admin login with Google OAuth and environment-configured credentials (`ADMIN_USERS`).
  - Admin dashboard: timetable master view, Excel spreadsheet importer with alias normalization, single-class cancellations, one-off events with conflict detection, exam/emergency closures, and administrative action logs.
  - Theme switching across Light, Dark, and Darker themes with responsive mobile sheet support.
- **Planned:**
  - Push and calendar notifications for last-minute class cancellations or room reassignments.
  - Multi-building support across campus expansion sites.
  - Batch 2030 automated timetable ingestion upon academic term release.
