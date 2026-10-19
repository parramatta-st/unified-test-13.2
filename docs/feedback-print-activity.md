# Feedback student modes and print activity

Target: `parramatta-st/unified-test-13.2`, based on main commit `1097c9f8443d824a2307e22a836b7c76e081f83a`.
This change retains this repository's Inbox, time-clock, payroll, authentication, Next.js version and existing Feedback workflow.

## Feedback student views

The **My schedule / All students** switch sits to the right of the Parent Feedback heading and appears only after the authenticated roster confirms a booking for the tutor today (Sydney time). It wraps below the heading on narrow phones. With no booking, missing setup, a pending request or an unavailable schedule, the normal student picker remains available without a switch or schedule error box. The current day is checked again when the date changes while the page stays open.

The switch changes only how a student is found. It preserves the selected recipient and existing draft, including when a refresh removes today's booking. The preference is remembered per verified campus/tutor in that browser. My schedule starts with today's Sydney date and supports another date, Today and Refresh. Browsing another date does not change eligibility based on today's bookings. All students retains the existing searchable Student picker and recent students.

Unlike the reference Epping repository, this repository did not contain a student timetable. The new authenticated read-only `/api/feedback-schedule` adapter accepts the compatible roster format below. It does not import Epping records, create bookings, add an administration grid or integrate student bookings from Hapana. The earlier tutor-only Hapana/time-clock work remains a separate branch.

Configure this centre's roster before expecting scheduled names to appear:

- Private sheet: `timetable` in the existing spreadsheet by default.
- Optional overrides: `TIMETABLE_SHEET_NAME`, `TIMETABLE_SPREADSHEET_ID`.
- Optional server-side read-only source: `TIMETABLE_CSV_URL`.
- The Member IDs must refer to this portal's own student records (the existing `contacts` sheet/configuration). Never reuse another centre's Member IDs without explicitly reconciling them.

| Column | Meaning |
| --- | --- |
| campusKey | Exact verified centre key, for example `parramatta` |
| tutorName | Exact signed-in tutor name; no broad first-name matching |
| dayOfWeek | Weekly day, for example `Tuesday` or `Tue` |
| startTime / endTime | `16:00`, `4pm` or `4:30 pm`; valid same-day interval |
| studentId | Canonical student ID from this portal |
| studentName | Display fallback for a booking that needs setup |
| entryType | `weekly` or `one_off` |
| specificDate | ISO `YYYY-MM-DD` for one-off/makeup bookings |
| active | `TRUE` or `FALSE`; blank retains compatibility with active weekly rows |

The API derives campus/tutor from the verified session, ignores query-string attempts to change them, excludes inactive/wrong-date rows and joins canonical student details. Unknown/incomplete bookings are shown as needing setup and cannot populate a recipient. School year is optional. An unavailable schedule offers All students and does not block Feedback. No live roster was read or written during development.

## Printing

The page puts student selection and their latest accepted print batch first. Older batches are available through View history. Copies and student-name stamping are compact; service and colour details are under Print settings. Duplicate bottom controls and routine instructions were removed.

The shared `_app` activity provider owns the FIFO queue, so tutors can navigate between portal pages and submit more jobs while an earlier one sends. Student, Member ID, files, copies and colours are captured when submitted. Pending duplicate materials are rejected; waiting jobs can be cancelled. A brief initial confirmation minimises to the bottom-right panel. Phones use an expandable Printing bar with file details.

A **Sent to printer** notice disappears after five seconds. It means the print service confirmed acceptance, not that paper physically emerged. Failed/unknown jobs stay visible and never retry automatically. Accepted files are not resent to repair a failed history write. The print proxy records service acceptance with server-authenticated tutor/campus and timestamps, then the student history groups accepted files by batch. Both Manual Print and legacy Automatic Print source labels are supported. This main branch has no Epping rolling-print page, so this change does not introduce that separate academic/automatic-printing workflow.

No Mac service update is required. This is a browser-tab queue: keep the tab open until sends finish. Client-side portal navigation is supported; closing/reloading the tab can interrupt waiting files. Exit warnings and summary-only recovery notices are provided, and interrupted jobs never replay automatically. Different tabs/devices have independent queues. Student-name stamping remains the existing shared Mac setting and is disabled for changes while this tab has pending jobs.

## Validation

- `npm test`: existing clock/payroll/API suites, new schedule date/identity/API coverage and queue/history/print-proxy scenarios.
- `npm run typecheck` and `npm run build`.
- `node scripts/qa_print_api.cjs`: real local signed Next API to a fake Mac and local history webhook/CSV; no external credentials or physical output.
- `NODE_PATH=<isolated Playwright modules> QA_USE_BUILD=1 node scripts/qa_print_activity_browser.cjs`: desktop and phone flows, draft preservation, FIFO, captured copies, navigation, five-second dismissal, student history and non-replaying failure/reload notices.
- Existing `scripts/verify-door-browser.cjs`: door clock and payroll UI regressions in Chromium, Firefox and WebKit.

Browser/API fixtures use fictional students, sessions, printers and history. Actual centre roster setup, real Google Sheets latency and physical Mac/CUPS output require release acceptance testing.
