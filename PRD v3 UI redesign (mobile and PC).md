# PRD v3: UI redesign (mobile and PC)

Oct 26, 2026 · @Krish

## 1. Overview

PRD v2 is built, so this document covers only the interface: how the three pages look on a phone and on a PC, and the copy rules that apply to all of them. Data rules (timetable, closures, terms, seats) stay as set in PRD v2.

- **Pages:** Free now, Find a room, My group.
- **Layouts:** phone (390 px wide) and PC (1280 px wide). The same content and rules apply to both.
- **Goal:** show only what a student needs to decide where to study, with nothing that repeats on every page.

## 2. Screens

| Page | Phone (390 px) | PC (1280 px) | Removed from v2 UI |
| --- | --- | --- | --- |
| Free now | One column of rooms, longest free first; "free for at least" chips; bottom tab bar | Three-column grid of room cards; the same filter chips in the page header; top navigation | Greeting, "Live availability" pill, marketing sentence, stat cards |
| Find a room | Date, From and To in one box; floor chips; results list below | Form panel on the left (340 px); results list on the right | Marketing sentence, "Pilot building" label |
| My group | Group header with Change; six day chips; class and gap cards in a single column | Group panel on the left (320 px) with day chips; class and gap timeline on the right | Batch, Group and Date form, "Show schedule" button |

A gap between classes shows the rooms free for the whole gap. On the PC, the rooms appear as chips, as on the phone.

Below the day chips, My group has an "Other date" button. It opens a date picker for any date, including future dates, and accepts a pasted date. The day chips show the current week only.

## 3. Layout and copy rules

These apply to every page on both layouts.

- No marketing copy. No greeting, no tagline, no status pill. The page title says what the page is.
- One line of freshness under the title: "5 rooms · updated 4:43 pm".
- The header shows only the product name, the page links and the account avatar.
- The bottom tab bar (phone) and the top links (PC) carry the same three pages in the same order.
- Touch targets are at least 44 px. Text is at least 13 px; labels that carry meaning are never colour alone (a "Free" or "Now" word sits beside any colour).
- No horizontal scrolling at 390 px. Wide content on the PC wraps or stacks below 900 px.
- Times are shown in the campus time zone, from the server clock, never the device clock.

## 4. Components

| Component | Used on | What it shows |
| --- | --- | --- |
| Room card | Free now (PC grid), Find a room (PC list rows) | Room name, floor and seats; "until" time and time left |
| Room row | Free now (phone), Find a room (phone) | The same content as a room card, as a list row |
| Filter chips | Free now, Find a room | One selected chip, filled dark; the rest outlined |
| Class card | My group | Time, room tag, subject (with "Lab" or "Now" where it applies), teacher and floor |
| Gap row | My group | Length of the gap and the rooms free for it, as chips |
| Day chips | My group | Mon to Sat; the selected day is filled dark |
| Bottom tab bar | Phone, all pages | Three pages with icon and label |
| Top links | PC, all pages | The same three pages as text links; the current page is marked |
| Account avatar | All pages | Initial in a circle; opens the account menu |

## 5. Decisions and build order

**Decided**

- [x] The Rooms button becomes a Rooms page (section 6). It is a fourth tab on the phone and a fourth link on the PC.
- [x] Exam closures are confirmed. A closed room shows "Closed for exams" in place of its times. No banner.
- [x] Outside 6 AM to 10 PM, Free now keeps showing rooms as open. There is no "Closed" state.
- [x] After 10 PM, a free room shows the next opening time (6 AM), not "Open".
- [x] The account menu holds account details, rename, preferences and sign out (section 7).
- [ ] Preferences: contents to be decided later.

**Build order for v3**

1. Header, top links and bottom tab bar on all pages, with Rooms as a fourth tab or link.
2. Remove the greeting, pill, marketing sentence, stat cards and the "Building is currently closed" banner.
3. Free now: keep showing rooms outside building hours, with no Closed state.
4. Free now: room row (phone) and room card grid (PC).
5. My group: class card and gap row, then the PC timeline.
6. Find a room: phone form and results; PC two-column layout.
7. Rooms page: room and day chips, booking rows and free rows (section 6).
8. Account menu: account details, rename, preferences and sign out (section 7).
9. Closure notice and greyed-out closed rooms restyled to the v3 components.
10. Responsive check at 390 px and 1280 px, with no horizontal scroll at 390 px.

## 6. Rooms page

The Rooms page shows, for one room, what is booked on each day and when it is free. It answers "who is using this room, and when".

- **Phone:** room chips across the top (C, 1A, 1B, 2A, 2B, 2C). 2B1 and 2B2 appear as chips only when 2B is split. Day chips Mon to Sat sit under them, with today selected by default. Rows follow in time order.
- **PC:** room list on the left (320 px). The selected room's day timeline sits on the right, with the day chips above it.
- **Booking row:** time range, then Batch and Group, subject and teacher. Example: "10:00 – 12:00 · Batch 2029 Group A · MERN" and "12:15 – 2:00 · Batch 2029 Group C".
- **Free row:** the gap in green, with the word "Free" beside the times. It has no subject.
- **Exam closure:** a closed room shows "Closed for exams" in place of its booking rows, for the closure's dates.
- **2B:** a booking in 2B1 or 2B2 is shown with its half's name. 2B is "Free" only when both halves are free.
- Times outside building hours are not shown. The freshness line and copy rules from section 3 apply.

## 7. Account menu

The avatar opens the account menu: a sheet on the phone, a small panel under the avatar on the PC.

- Name and email (read only).
- Rename: edit the display name.
- Preferences: contents to be decided later.
- Sign out.

No other items.
