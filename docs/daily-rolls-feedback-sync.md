# Daily Rolls student booking sync

Daily Rolls 0.6.0 and the matching portal release close the gap between browser-local rolls and Feedback's timetable. The companion source lives in `extensions/daily-rolls`. Its START-HERE.html and README.md contain the numbered installation and daily workflow.

## Setup

Use the same Chrome profile for Hapana and an admin signed into the production portal. Update the existing extension in place, reload it and refresh existing Hapana/portal tabs. Collect the day and check **Student bookings synced to Feedback**, then open `/admin/feedback-schedule` to link instructor labels to portal tutor accounts (e.g. Sai Arulanathan → Sai). Resolve unmatched students against Members. Refresh the tutor Feedback page. Only a linked booking for today in Sydney enables the switch.

No new secrets or manual spreadsheet setup are required. The existing service account and `TIMETABLE_SPREADSHEET_ID` (falling back to `GOOGLE_SHEETS_SPREADSHEET_ID`) are reused. The first real import creates the separate owned `feedback_roll_events` tab. Existing Members and tutor configuration remain authoritative. This release does not merge the separate Time Clock/payroll PR #13.

## Boundaries

- `/api/admin/feedback-rolls`: signed Parramatta-admin collection start, import and identity links; cross-site and non-isolated preview writes are rejected. Normal tutors cannot read the admin overview or upload schedules. No cross-campus/client-supplied identity is trusted.
- Collection start checks private Sheets access and issues a two-hour HMAC ticket bound to admin/campus/date/capture ID. Import revalidates a strict payload, dropping unknown fields. Only Hapana IDs, names, class titles, tutor labels and times are saved. Phone/payment/parent details and room choices are excluded.
- Imports append whitelisted signed session rows and a signed digest/count commit marker. Readers require a complete valid capture. Duplicate receipts are idempotent, changed capture-ID reuse is rejected, ordering follows server-issued collection time and older collections cannot overwrite newer substitutions. Reads derive current state, avoiding a mutable replacement view racing across server instances.
- Observed-session imports update only those classes; confirmed full-day imports replace the included group-class day. Changing a tutor on a stable session removes that session from the old tutor. Empty days are rejected because the reader cannot prove that no classes exist. Assessment/diagnostic and one-to-one exclusions remain.
- Exact unique canonical names match automatically. Other instructor names require explicit admin links to active campus tutors. Student links use stable Hapana client IDs and active canonical Member IDs; ambiguous or missing names are never guessed. Unknown/incomplete Members remain disabled in Feedback. Link updates are audited and remembered across dates. Parent recipients are loaded from canonical Members on each Feedback read, never from the extension payload.
- `/api/feedback-schedule` uses committed Daily Rolls for that date when present; the existing manual/CSV timetable remains the fallback for dates with no imports. A synced day is authoritative, so obsolete manual rows do not keep an old tutor scheduled after substitution. No payroll/clock records are created or changed.
- The extension obtains the ticket before class collection, sends only completely verified rosters, and keeps student payloads/tickets in memory. Existing local tutor-only snapshots/exports remain unchanged. Successful local backup, optional tutor-only Time Clock sync and student Feedback sync have separate confirmations. Closing the tab requires recollection before retrying student sync.

Changing the portal session secret invalidates stored row signatures as well as sessions; recollect required dates after a deliberate secret rotation. Storage is append-only; retention/archival is an operational follow-up if the ledger grows substantially. Production data was not used by automated tests.

## Verification

`npm test` covers signed imports through the mocked private Sheets ledger into the actual tutor Feedback API, Sai aliases, canonical recipient matching, substitutions, partial/full replacements, stale/tampered/expired captures, retries, permissions and upstream failures. Extension reader/model/UI/worker/bridge tests remain under `extensions/daily-rolls/tests` with additional student-sync coverage.

`scripts/qa_feedback_rolls_browser.cjs` installs the real extension in Chromium and intercepts all Hapana/production-origin requests. The portal uses an actual Next server and signed admin/tutor sessions; only Google Sheets is simulated via a test-only preload in the child process. It verifies collection, import, explicit instructor/student linking on desktop/phone, Feedback recipient/draft behaviour, substitution removal, failed upload, retry/idempotence and exclusion of student names from local tutor backups. No email, attendance, payroll or physical printer action is performed. Fictional screenshots are kept as short-lived CI artifacts.

After deployment, the user must reload the extension on their own computer, sign in, collect a real existing day, resolve links and verify the first displayed students/parent recipients. This browser profile cannot be updated remotely by the assistant.
