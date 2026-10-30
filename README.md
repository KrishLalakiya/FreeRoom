# FreeRoom

FreeRoom shows which classrooms in a college building are free right now, how long they stay free, which rooms open tomorrow, and which rooms a student can use between classes.

- **Live app:** https://freeroom-nine.vercel.app
- **Demo video:** https://youtu.be/dG45sPS2R54

## Problem

Students walk between classrooms looking for an empty room to study or meet a group. Timetables are kept in spreadsheets that students cannot easily check, so nobody can see which rooms are free, when they become busy, or which rooms are free during their own gap.

FreeRoom turns the weekly timetable into a live availability view. Students can browse without signing in.

## Features

### Students (no sign-in needed)

- **Free now:** rooms free at this moment, with the time each one stays free. Filter by minimum free time.
- **Find a room:** choose a date, a time window and a floor. Open a room to see its full day, with each booked slot and the free gaps.
- **My group:** choose a batch, group and day to see that group's classes. Each gap shows the room that covers the whole gap. If no single room does, the app shows a chain of rooms or the longest free stretches.
- **Next day:** while classes are still running, the card shows today's remaining rooms. After the last class, it shows "All classes are over for today" and then tomorrow's rooms with their first class.
- **Batch and group memory:** the batch and group are asked for on the first visit and remembered on that device.
- **Optional Google sign-in:** signed-in students keep their batch, group and settings across devices.
- **Themes:** light and dark modes.

### Admins (two configured accounts only)

- Import a weekly timetable from an `.xlsx` file, with validation and room-name matching. Only valid rows can be imported.
- Create, edit and delete academic terms.
- Cancel a single class on a given date.
- Add one-off events, with clash detection.
- Add holidays, breaks, and exam or room closures for a room, a floor or the whole building.
- View the action log of every admin change.

## How availability works

For each room and moment, the availability engine:

1. Finds the term that covers the date.
2. Collects the room's busy blocks for that weekday from the timetable.
3. Applies cancellations, closures and one-off events, which override the timetable. Holidays and breaks are no-class days, so the timetable is skipped on those days.
4. Subtracts the busy blocks from building hours (06:00 to 22:00, Asia/Kolkata) to get the free gaps.

Room 2B is split into 2B1 and 2B2. Room 2B counts as free only when both halves are free.

Results are cached for 60 seconds and cleared on every schedule change.

## Tech stack

- **Frontend:** React 19, Vite 8
- **Backend:** Node.js (ES modules), Express 4, express-rate-limit, multer, cors
- **Database:** PostgreSQL, accessed with `pg`
- **Authentication:** Google sign-in with `google-auth-library`, session tokens with `jsonwebtoken`, admin passwords with `bcryptjs`
- **Timetable import:** `xlsx` (SheetJS)
- **Testing:** Vitest
- **Hosting:** Vercel (frontend), Render (API), Supabase (PostgreSQL)

## Project structure

```text
client/          React app (pages, components, theme CSS)
server/
  src/
    config/      database connection, migrations, seed data
    middleware/  authentication and admin checks
    routes/      auth, rooms, reports, admin
    services/    availability engine, gap planner, timetable import, cache
    utils/       campus time-zone helpers
  scripts/       next-term upload command
  tests/         unit tests
docs/            operations runbook for uploading a new term
```

## Getting started

### Prerequisites

- Node.js 18 or later
- PostgreSQL 14 or later

### Run locally

```bash
# 1. Install dependencies
cd server && npm install
cd ../client && npm install

# 2. Configure the server
cp server/.env.example server/.env
# Edit server/.env (see Environment variables below)

# 3. Create the tables and load the building and terms
cd server
npm run migrate
npm run seed

# 4. Start the API and the web app (two terminals)
cd server && npm run dev        # API on http://localhost:5000
cd client && npm run dev        # web app on http://localhost:5173
```

### Run tests

```bash
cd server && npm test
```

### Build the web app

```bash
cd client && npm run build
```

## Environment variables

Keep real values out of Git. Put them in `server/.env` locally and in the hosting provider's settings in production. The full list is in `server/.env.example`.

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | Signs session tokens. Required in production |
| `JWT_EXPIRES_IN` | Token lifetime (15 days) |
| `GOOGLE_CLIENT_ID` | Google sign-in client ID |
| `ADMIN_EMAILS` | The two admin email addresses |
| `ADMIN_USERS` | Admin email and bcrypt password hash pairs, if password sign-in is used |
| `CLIENT_URL` | The web app's URL, allowed by CORS |
| `CAMPUS_TIMEZONE` | Time zone for all displayed times (`Asia/Kolkata`) |
| `BUFFER_MINUTES` | Minutes kept free around each class (default 0) |
| `NODE_ENV` | `development` locally, `production` when deployed |

## Timetable and terms

Each batch's timetable is one `.xlsx` file for one term.

1. Create the term (batch, semester, term number, start and end dates) in the admin dashboard.
2. Upload the spreadsheet for that term. Fix any reported rows, then import.
3. Add closures and holidays for the term's exam weeks and breaks.

The full procedure, including the command-line upload, is in `docs/OPERATIONS_NEXT_TERM.md`.

## Deployment

- **Web app:** Vercel. Set the API address in the frontend environment.
- **API:** Render web service, in the same region as the database. Set `NODE_ENV=production`, `JWT_SECRET`, `CLIENT_URL` and the other variables above.
- **Database:** Supabase PostgreSQL, in the same region as the API.

Check `GET /api/health` after deploying. It should return `"status":"ok"` and `"env":"production"`.

## Security

- Admin access is limited to the two accounts in `ADMIN_EMAILS`. Any other sign-in, including one whose address contains "admin", is a student.
- CORS allows only the configured web app URL and this project's preview URLs.
- Mock time, used for testing, is honoured only for the two admin accounts.
- Secrets are read from environment variables. Do not commit `.env` files.

## Status

**Working**

- Free now, Find a room, My group and Next day views
- Gap planner with single-room and chained recommendations
- Room 2B split into 2B1 and 2B2
- Google sign-in and cross-device settings
- Admin dashboard: timetable import, cancellations, events, closures, no-class days and the action log
- Multi-building support (the building ID is no longer hard-coded)
- Automatic ingestion of the Batch 2030 timetable
- Availability queries respond in about 2 seconds at most (PRD v8 and v9)

**Planned**

- Notifications for last-minute cancellations and room changes

