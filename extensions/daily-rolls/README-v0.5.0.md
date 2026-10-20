# Success Tutoring Daily Rolls — v0.5.0

This update adds automatic tutor-only schedule sync through the signed-in Parramatta portal. The matching portal implementation is in [review PR #13](https://github.com/parramatta-st/unified-test-13.2/pull/13). **It must be released to the production portal before central sync can succeed.** Until then, collection, printing and local backups work, with an explicit portal-sync failure message.

## Install and use

1. Copy all files from this `hapana-rolls` folder into the permanent extension folder already loaded in Chrome.
2. Reload the existing extension at `chrome://extensions`, confirm **0.5.0**, and refresh both Hapana and the portal. Chrome may ask you to approve access to the named portal host.
3. Sign in as an admin at `https://unified-site.successtutoringparramatta.com` in the same Chrome profile. No API keys or Google credentials are entered into the extension.
4. Open Hapana Day view, select the date, clear schedule filters and launch Daily Rolls. The first automatic collection updates visible classes.
5. If all classes are visible, tick **All classes for this day are visible** before pressing **Collect selected day**. That verified collection replaces the included day, removing classes no longer present. Otherwise unseen previously stored classes are retained.
6. Check the explicit **Saved locally and synced to the portal** message. Regenerate after substitutions, cancellations or tutor changes.

Do not uninstall/reinstall the extension or move its folder to a new identity to update it; keep the existing installation to retain local histories. Student data and room choices remain only in the review tab's memory.

## What is synced

Tutor names, class titles, Sydney dates and start/end times, stable Hapana session IDs, capture timestamps/mode and excluded-session counts. **No student names, phone numbers, email addresses, payment data, room preferences or Hapana URLs.** Normalised tutor names strip only recognised trailing `(sub)`/`(substitute)` status; the original instructor label remains available.

The extension saves a local record only when every included class is verified. It obtains a signed portal collection token before reading individual class details, then submits that verified capture through the portal content script. The server authenticates the admin and campus. Portal credentials and the collection token are never written into the local schedule/export.

The portal stores committed imports and name mappings in a separate `hapana_schedule_events` tab in the existing Time Clock spreadsheet. It does not use schedules to create payroll shifts. Substitutions replace the expected tutor by session ID. Signed server collection ordering prevents older collections from overwriting newer substitutions.

## Errors and retries

- Incomplete, stopped and demo collections never change stored schedules.
- A failed new day read cannot re-stamp previously displayed classes.
- Local storage failure preserves prior data and is shown explicitly.
- A successful local save with a failed portal upload says **Saved locally. Portal sync was not confirmed**. Verified printing remains available.
- **Retry saving / syncing** retries the same verified capture. Server and local idempotency prevent duplicate records.
- If the original portal connection was unavailable, the admin changed, or its two-hour token expired, sign in and collect the day again. A new token is needed before collection, not after it.
- A saved-date view or JSON export is a local backup, not proof of a successful portal upload.

Chrome's local record uses the original `stp-schedule-v1:parramatta:YYYY-MM-DD` key and keeps the latest 50 revisions for each day. Old retained dates are not automatically deleted. Quota failures are surfaced. Export important local schedules until the central deployment is in routine use.

## Matching and review rules on the portal

- Only scheduled group classes are checked, with a 20-minute missing-clock-in grace period.
- Any overlapping non-void shift for that tutor/campus counts; late starts and early finishes do not cause separate warnings.
- Unscheduled markers and other staff may clock in normally. No reverse booking check is made.
- An open shift counts as clock-in evidence. Open or completed shifts **over eight hours** need duration review; the class finish time does not trigger a warning.
- Completed long hours are held from payroll until an explicit versioned admin approval. Open shifts need actual finish times first. Corrections invalidate previous approval.
- Exact unique tutor names match automatically. The admin alert panel resolves aliases explicitly; names are never matched by a guessed first name.

The existing exclusion of assessments, diagnostics and one-to-one sessions is retained. An empty day cannot clear an old schedule in this release. The portal labels missing/full-day sync coverage so excluded or unsynced work is not silently claimed to be checked.

## Verification and source

Dependency-free extension checks:

```sh
node tests/run.cjs
node tests/schedule-unit.cjs
node tests/schedule-flow.cjs
node tests/portal-bridge.cjs
```

**83 automated extension checks** cover extraction/printing regressions, local storage/replays, real review/controller code with simulated Chrome APIs, remote-sync failure/retry and the narrow portal bridge.

`tests/browser-schedule.cjs` is also included for a real Chromium extension test against intercepted fictional Hapana/portal pages. It requires Playwright plus an installed Chromium executable. All 10 of its scenarios passed in an isolated Vercel Sandbox against intercepted fictional pages. The portal’s separate GitHub workflow passed 78 tests, typecheck, build and 46 Chromium/Firefox/WebKit journeys on the scoped review commit, also using synthetic data.

See **TEST-RESULTS.md** for evidence and limitations. `README-v0.4.0.md`, `INTEGRATION-PLAN-v0.4.0.md` and older test results are historical and do not describe the current release state.

## First operational check after portal release

Collect a real existing day without changing bookings. Confirm the local/remote success message and the portal's last-sync date. Resolve any unmapped instructor names. Check a known clocked shift is recognised and that an unscheduled marker shift produces no schedule accusation. Inspect one tutor and one crowded room-hour print preview. Only save/correct/approve actual payroll records after checking the times.
