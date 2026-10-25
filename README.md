# FreeRoom (Version 2)

FreeRoom is a web application designed for campus college students to discover which classrooms in a campus building are empty, right now or for a planned future study window, and exactly how long they will remain free.

---

## 1. Features in Version 2

### 🕒 Operating Hours & Free Time (C1)
- Building operating hours are configured as **06:00 to 22:00 (6 AM to 10 PM)**.
- Free intervals are strictly bounded by these hours. When a room has no more classes for the day, FreeRoom displays **"Free until 10:00 PM"** instead of an unbounded interval.
- Before 06:00 or after 22:00, the building is marked closed.

### 🪑 Room Capacities & 2B Partition Hierarchy (C16)
- Standard lecture classrooms have **200 seats**.
- Partitioned room **2B** splits into **2B1 (100 seats)** and **2B2 (100 seats)**.
- Booking/class in parent room 2B blocks both sub-rooms 2B1 and 2B2; a class in either 2B1 or 2B2 marks 2B occupied while leaving the other half free.
- Capacity filter allows students to search for rooms meeting minimum seat counts (e.g. 50, 100, 200).

### 📅 Terms, Batches, & Relational Timetable (C3, C4, C17, C18)
- Academic calendar is organized into **Batches** (e.g. Batch 2028, Batch 2029, Batch 2030) and **Terms** (e.g. Semester 3 / Term 5; Semester 5 / Term 9).
- Timetable entries belong to specific terms with start and end dates.
- Importer parses multi-attribute cells:
  - **Batch & Groups:** Group A, Group B, Group C, or combined cohorts (Group A+B, whole batch).
  - **Subject:** Normalized course names (MERN, CN, CML, FDSA Repeat, etc.).
  - **Instructor:** Faculty name parsed and linked.
  - **Class Type:** Categorized as **lecture**, **lab** (e.g. "MERN (Lab)"), or **club** (Academic Clubs).
  - **Provenance:** Raw Excel cell location (`sheet_name`, `sheet_row`, `sheet_col`, `raw_cell`, `source_file`) saved for full administrative transparency.

### 📄 Multi-Batch Sheet Compatibility (C21, C22)
- Supports structural differences across batch sheets (2-group vs 3-group layouts, column headers, bracketed room names).
- Normalizes diverse room naming variations (e.g. `"Class C Ground floor"`, `"class C Ground floor"`, `"(Classroom C, 2nd Floor)"`) via an alias mapping table.
- Propagates course context to dependent un-named "Lab" cells located directly beneath lecture cells.
- **Cross-batch overlap warnings:** Classes from different batches scheduled in the same room generate administrative warnings rather than blocking uploads.
- **Club event deduplication:** Academic club events appearing identically in both 2028 and 2029 sheets are automatically deduplicated.

### 🚫 Exam & Emergency Closures (C6, C7, C8, C9)
- **Three Scopes:** Building-wide, Floor-wide, or Room-specific closures.
- **Precedence:** Closures rank above timetable schedules. A floor closure blocks every room on that floor; a closure on 2B blocks 2B1 and 2B2.
- **Multi-day & Time Ranges:** Closures support single-day, multi-day exam periods, or partial-day hour windows (e.g. 09:00–13:00).
- **Student UI:** Closure banner displayed prominently; closed rooms appear greyed out with exam badges and reasons; timeline displays distinct red closure blocks.
- **Admin Management:** Intuitive closures page with list, delete, filter, and 2-step confirmation modal before applying whole-building shutdowns.

### 🏖️ No-Class Days for Holidays & Breaks (C2, C12)
- Replaces v1's closed-building assumption: college buildings remain open on holidays and breaks, but classes do not run.
- Admin can mark dates as **No-Class Days**, skipping weekly timetable classes so all rooms remain open and free for self-study.

### ⚡ Caching & Invalidation (C10)
- In-memory availability cache with 60-second TTL for free-now, free-window, and room timeline calculations.
- Automatic cache invalidation upon any schedule mutation (term create/edit/delete, timetable upload, closure create/merge/delete, no-class day change, or class cancellation).

### 🔍 Error & Failure Handling (C11)
- Rejection of closures where end precedes start (dates or times).
- 404 validation for closures on non-existent rooms or floors.
- Overlapping closures are automatically merged into an expanded range.
- Same-batch overlapping terms are rejected (409 Conflict); cross-batch sharing is permitted.
- Dates outside any defined academic term show room availability as `"unknown"`, never falsely reported as free (C5).
- Timetable rows with dates outside their term are flagged with row errors.

---

## 2. Architecture Diagram

```mermaid
graph TD
    subgraph Client ["Frontend (React + Vite, Vanilla CSS)"]
        UI_Home["Free Now Page"]
        UI_Plan["Plan Future Window"]
        UI_Room["Room Timeline & Detail"]
        UI_Admin["Admin Suite (Terms, Timetable, Closures)"]
        ClientService["services/api.js (JWT Auth)"]
    end

    subgraph Server ["Backend (Node.js + Express API)"]
        AuthRoutes["routes/auth.js (Google OAuth & Dev Login)"]
        RoomRoutes["routes/rooms.js (Free-now, Free-window, Timelines)"]
        AdminRoutes["routes/admin.js (CRUD Operations & Uploads)"]
        
        subgraph EngineLayer ["Core Engine & Caching"]
            Cache["services/cache.js (AvailabilityCache, TTL 60s)"]
            Engine["services/availabilityEngine.js"]
            Importer["services/timetableImport.js"]
        end
    end

    subgraph Database ["PostgreSQL Database"]
        DB_Core[("buildings, rooms, room_aliases")]
        DB_Academic[("batches, terms, groups, subjects, instructors")]
        DB_Timetable[("timetable_entries, timetable_entry_groups")]
        DB_Overrides[("closures, no_class_days, schedule_exceptions, events")]
        DB_Users[("users, reports")]
    end

    ClientService -->|REST API / JSON| RoomRoutes
    ClientService -->|REST API / JSON| AdminRoutes
    ClientService -->|REST API / JSON| AuthRoutes

    RoomRoutes --> Cache
    RoomRoutes --> Engine
    AdminRoutes --> Importer
    AdminRoutes -->|Invalidate| Cache

    Engine --> DB_Core
    Engine --> DB_Academic
    Engine --> DB_Timetable
    Engine --> DB_Overrides

    Importer --> DB_Academic
    Importer --> DB_Timetable
```

---

## 3. Database Schema (Entity-Relationship Diagram)

```mermaid
erDiagram
    BUILDINGS ||--o{ ROOMS : contains
    ROOMS ||--o{ ROOMS : "parent (2B -> 2B1, 2B2)"
    ROOMS ||--o{ ROOM_ALIASES : mapped_by
    
    BATCHES ||--o{ TERMS : has
    BATCHES ||--o{ GROUPS : contains
    
    TERMS ||--o{ TIMETABLE_ENTRIES : contains
    ROOMS ||--o{ TIMETABLE_ENTRIES : hosts
    SUBJECTS ||--o{ TIMETABLE_ENTRIES : taught_in
    INSTRUCTORS ||--o{ TIMETABLE_ENTRIES : instructs
    
    TIMETABLE_ENTRIES ||--o{ TIMETABLE_ENTRY_GROUPS : links
    GROUPS ||--o{ TIMETABLE_ENTRY_GROUPS : attends

    BUILDINGS ||--o{ CLOSURES : applies_to
    ROOMS ||--o{ CLOSURES : applies_to
    BUILDINGS ||--o{ NO_CLASS_DAYS : observed_in

    TIMETABLE_ENTRIES ||--o{ SCHEDULE_EXCEPTIONS : cancelled_on
    ROOMS ||--o{ EVENTS : hosts

    USERS ||--o{ CLOSURES : creates
    USERS ||--o{ NO_CLASS_DAYS : creates
    USERS ||--o{ REPORTS : submits
```

---

## 4. Availability Engine Execution Lifecycle

For any given room and date query:

1. **Term Lookup:** Determine if any academic term covers the queried date. If none exists, return status `"unknown"`.
2. **Holiday / No-Class Day Check:** Verify if the date is marked as a no-class day. If so, weekly timetable occurrences are skipped.
3. **Weekly Timetable Expansion:** For active terms, expand recurring timetable rows matching the query day of week, applying the configured 5-minute pre/post class buffer.
4. **Partition Hierarchy Expansion:** If querying 2B, aggregate classes from sub-rooms 2B1 and 2B2; if querying 2B1 or 2B2, aggregate classes from 2B.
5. **Exception Subtraction:** Remove occurrences cancelled via `schedule_exceptions`.
6. **One-Off Events:** Merge one-off room events.
7. **Exam Closures Block Injection:** Query all closures matching the building, floor, or specific room (including 2B partition hierarchy). Closures rank with highest priority.
8. **Gap Calculation:** Bounded by building hours (**06:00 to 22:00**), calculate free intervals between busy blocks.
9. **Result Resolution:**
   - If a closure covers the window or whole day: return `"closed"` with reason and scope.
   - If free for the requested duration: return `"free"` with `free_until` (capped at 22:00).
   - If busy: return `"busy"` with details of current/upcoming class.
10. **Cache Store:** Results cached in memory for 60 seconds.

---

## 5. Development & Testing

### Prerequisites
- Node.js (v18+)
- PostgreSQL (v14+)

### Configuration (`.env`)
```env
PORT=5000
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/freeroom
CAMPUS_TIMEZONE=Asia/Kolkata
BUILDING_OPENING_TIME=06:00
BUILDING_CLOSING_TIME=22:00
BUFFER_MINUTES=5
JWT_SECRET=supersecretjwtkeyforfreeroom
```

### Setup & Database Seeding
```bash
# Install root, server, and client dependencies
npm install
cd server && npm install
cd ../client && npm install
cd ..

# Run database migrations and seed v2 batches, terms, and sheets
node server/src/config/migrate.js
node server/src/config/seed.js
```

### Running Tests
The test suite contains 99 automated unit tests covering timezone calculations, availability engine, timetable parsing, term boundaries, cache invalidation, and failure handling:
```bash
cd server
npx vitest run
```

### Running the App Locally
```bash
# Start both client and server concurrently
node start.js
```
- Frontend: `http://localhost:5173`
- Backend API: `http://localhost:5000`
