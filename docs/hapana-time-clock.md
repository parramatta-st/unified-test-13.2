# Hapana schedules and Time Clock review

This release adds a one-way check: scheduled group classes require an overlapping clocked shift after a 20-minute grace period. A marker or tutor can clock in without a timetable booking. Late starts and early finishes do not create separate attendance warnings.

## Daily workflow

1. Sign in as an admin at `https://unified-test-13-2.vercel.app` in the same Chrome profile used for Hapana.
2. Update Daily Rolls to v0.5.0, reload its existing extension and refresh both Hapana and the portal.
3. Collect the selected Hapana Day view. Clear filters and confirm **All classes for this day are visible** when replacing the whole day. Otherwise the update retains previously observed classes not visible in the current collection.
4. Check the explicit **Saved locally and synced to the portal** message. A local save alone does not mean the upload succeeded.
5. Regenerate rolls after substitutions or cancellations. The same stable Hapana session ID changes to the replacement tutor; it does not leave the original tutor scheduled as well.

If Hapana's instructor label differs from the portal name, open the top **Time Clock alerts** panel and select the correct portal identity. Exact, unique names match automatically; first-name guesses do not. Unmapped names produce a mapping issue rather than accusing the wrong person of missing a shift.

## Storage and security

Tutor-only schedules are stored in `hapana_schedule_events`, an additional append-only tab in the **same spreadsheet resolved by Time Clock**. It uses `TIME_CLOCK_SPREADSHEET_ID`, falling back to `GOOGLE_SHEETS_SPREADSHEET_ID`. The existing service account is reused.

Each upload consists of whitelisted session rows and a commit marker with selected row IDs, row count, digest, mode and capture fingerprint. Reads derive the current expected sessions from committed imports. There is no mutable schedule view that can be overwritten by another instance's stale cache. Incomplete or altered imports cannot replace a good schedule. Retries of a committed capture are idempotent. Imports finishing out of order are resolved by server-issued collection time, not the computer's clock.

The extension requests a signed two-hour collection token **before** collecting class details. Tokens are bound to the signed-in admin, campus, date and capture ID. An older collection cannot overwrite a later accepted substitution. A token expiring or an admin sign-in changing requires a fresh collection. The token and portal session credentials are not included in schedule exports or logs.

The portal content-script bridge only calls the same-origin schedule endpoint; it never receives the service-account credentials or reads the HttpOnly session cookie. The server authenticates every action and derives admin identity/campus itself. Allowed extension hosts are limited to Hapana and the named Parramatta portal. No other campus is added.

The schedule ledger stores tutor names, class titles and times, session identity, import metadata and admin tutor-name mappings. Student names, contacts, emails, payment details, room choices and Hapana URLs are not uploaded. Local tutor-only backups keep the existing latest-50-revisions-per-day limit. Existing printouts still contain the staff details selected for printing.

The old `time_clock_events`, shifts and adjustments remain the authoritative payroll ledger and views. Schedule comparisons never create, edit, clock out or approve payroll shifts automatically.

## Alerts

- Missing clock-in starts at exactly 20 minutes after the scheduled start.
- Any positive overlap from the same stable tutor ID and campus counts. Touching only the start/end boundary does not.
- A current open shift counts as evidence of clock-in. Future starts, voided shifts and invalid intervals do not.
- One longer shift can cover several scheduled sessions.
- Unscheduled marker shifts are accepted; no reverse timetable check is made.
- No warning fires just because the scheduled class ended.
- Alerts refresh once a minute while visible, when the window regains focus and after a shift action. A failed refresh retains prior alerts and shows a failure message.
- Missing sessions remain derived from saved history until a correcting shift, mapping or full-day schedule update resolves them. The panel is admin-only.

Only the group classes included by Daily Rolls are covered. Assessments/diagnostics and one-to-one sessions remain excluded. No schedule synced today is shown explicitly. An empty day cannot erase an existing schedule with this collector; a separately verified empty-day/cancellation workflow is still required for that edge case.

## Eight-hour review and payroll

The default unified threshold is eight hours. `TIME_CLOCK_REVIEW_HOURS` can configure it; the old separate `TIME_CLOCK_LONG_SHIFT_HOURS` and `TIME_CLOCK_OPEN_SHIFT_ALERT_HOURS` no longer control it.

Exactly eight hours is clear. More than eight hours, including one additional second, raises duration review. Open shifts add no payroll hours and need a real finish time before approval. Completed long shifts are omitted from payroll summary/export until an admin explicitly approves the recorded hours.

Approval is an `admin_approve` event in the existing ledger, bound to the current shift version. It records approver, timestamp and exact start/end values. A stale approval is rejected. Any later correction invalidates the approval, so a still-long corrected shift requires another review. Approval does not remove invalid-time, overlap, Sunday-category or location review flags. Invalid, future and overlapping completed shifts also remain excluded from payroll totals.

Review the individual shift's raw hours in Details; the summary and exported CSV contain the eligible hours. Past long shifts will also be held until reviewed. No historic clock times are changed by deploying this rule.

## Easier manual entry

- Type `4pm`, `4:30 pm`, `4.30pm` or `16:30`; recognised input formats to `4:30 pm` on blur.
- Bare `4` is rejected rather than silently guessing morning/evening.
- Today/Yesterday shortcuts and common shift-time buttons fill fields only; they do not save an entry.
- The payroll page does not default to the first tutor. An explicitly selected tutor, an alert's tutor or the header's selected team member may be prefilled.
- The hours preview uses the same Sydney/DST validation as the server. New manual entries still need both actual start and end times on one date; notes remain optional.
- Corrections and voids retain required written reasons; approval accepts an optional note.
- Save retries retain duplicate protection. Keyboard focus, Escape, body-scroll restoration and small-screen scrolling remain supported.

## Release checks

The review branch runs the complete test suite, typecheck, Next production build and Chromium/Firefox/WebKit browser journeys on synthetic isolated data. The extension has separate reader/worker, schedule, flow and bridge tests. Never point the browser verifier at production or create live payroll test records without the user's intent.

The extension connects to the production portal origin. Until this portal change is released there, a v0.5.0 local save remains available but remote sync reports an unavailable endpoint; do not treat it as a successful central upload. Release the tested portal changes before enabling routine v0.5.0 collection.
