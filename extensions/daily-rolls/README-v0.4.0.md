# Success Tutoring Daily Rolls — v0.4.0

Part 1 of the Hapana / Time Clock integration: **working browser-local tutor schedule capture and substitution history**. The portal connection, 20-minute alerts, eight-hour reviews and approval controls are not active in this release.

Open **START-HERE.html** for installation. There is no build step and no API key needed.

## Update

1. Unzip the package and copy every file in `hapana-rolls` into the permanent folder already loaded in Chrome. Keep the existing installation and folder identity.
2. Open `chrome://extensions`, reload Success Tutoring Daily Rolls, and confirm version **0.4.0**.
3. Close old review tabs and refresh every open Hapana tab. Collect a new day.

Removing the installed extension or installing a separate copy can lose or separate the saved local schedules. Merely reloading the existing extension preserves them. Student records and room choices continue to exist only in the review tab's memory.

## What works in Part 1

- A fully verified collection automatically saves the tutor schedule, independently of choosing rooms or printing.
- A session is keyed by Sydney date plus Hapana's `seid` and `eid`. Changing the assigned tutor updates that session rather than adding a second tutor assignment.
- A recognised trailing `(sub)` or `(substitute)` is removed from the normalised tutor name. The original label is kept in the schedule history. Other annotations are preserved.
- Every save records a revision, the collection timestamps and before/after assignment changes.
- Failed, stopped, incomplete and demo collections never replace the saved schedule.
- Concurrent saves are serialised by the extension worker. A collection started earlier cannot overwrite a later accepted collection for the same day.
- A retry of the same capture is idempotent. Storage failures show an explicit message and preserve the previous record.
- Saved schedules can be viewed by date and exported as JSON, including substitution history. Export is a backup/review file; the portal does not yet accept it.
- No network permissions are added. Nothing is sent to the portal in Part 1.

## Full day versus filtered view

The first collection starts automatically when Daily Rolls opens. It defaults to updating only the visible classes. Unseen previously saved classes are kept.

Before pressing **Collect selected day**, tick **All classes for this day are visible in Hapana (no schedule filters)** if the Hapana day is complete. The next successfully verified collection will replace the full included day and remove previously saved classes that are no longer present. The choice is frozen when collection starts. Regenerate the rolls after substitutions or cancellations.

This acknowledgement is necessary because the current Hapana reader cannot prove that schedule filters are cleared. An empty day cannot erase existing records in this release. Removing every class from a previously saved day needs a separately verified cancellation workflow in the portal stage.

## Where information is stored now

Chrome's extension-local storage, under `stp-schedule-v1:parramatta:YYYY-MM-DD`. One record per date contains the current tutor schedule and the latest **50 revisions** for that date. Revision numbers keep increasing after that history cap; the screen and export label truncation. Saved dates are not automatically deleted. Chrome's storage limit can eventually be reached; failed saves are visible rather than silently pruning data.

Saved fields are restricted to tutor names, class titles, stable session IDs, start/end minutes, campus/date/timezone, timestamps, change history and the number of excluded sessions. **Student names, phone numbers, emails, payment data, room choices and Hapana URLs are never persisted in the tutor schedule.** Student details can still appear on existing staff printouts.

The local record survives closing the tab or Chrome, but is not shared between computers and is not a substitute for the planned central schedule store. Export important schedules until the central connection is delivered. There is no restore/import button in Part 1.

## Coverage

Only the group classes already included by Daily Rolls are captured. Assessments/diagnostics and one-to-one sessions remain excluded. No claim is made that every paid tutor task appears in Hapana. A cancelled class that remains visible with an assigned instructor will remain scheduled until Hapana is updated and rolls are regenerated.

The reader currently supplies an instructor display name, not a verified portal tutor ID. Central matching will use an explicit admin-maintained mapping. Ambiguous names must not be guessed.

## Implementation

- `schedule-model.js`: strict input contract, field whitelist, deterministic merge/replacement and revision history.
- `schedule-ui.js`: saved-day display, history, explicit failures, retry and JSON export.
- `background.js`: sole owner of durable writes; exact extension review-page check and serialised writes.
- `review.js`: saves only the latest fully verified collection. A failed new day read cannot re-stamp old displayed classes.
- Existing readers, room suggestions and print fitting are retained; `CHANGELOG-v0.3.5.md` documents prior behaviour.
- `INTEGRATION-PLAN.md`: central storage design and remaining alert/approval work, grounded in the inspected production portal source.

## Verification

Run from this folder:

```sh
node tests/run.cjs
node tests/schedule-unit.cjs
node tests/schedule-flow.cjs
```

**77 automated checks passed:** 44 existing regression checks, 22 schedule/worker checks and 11 simulated UI/collection flows. The simulated DOM does not verify rendering, Chrome permission behaviour or physical printing.

`tests/browser-schedule.cjs` is supplied for real Chromium extension testing with intercepted fictional Hapana pages. It requires Playwright and its installed Chromium executable. It could not run in the build environment because Chromium was absent, so its scenarios are **not counted as passes**. See `TEST-RESULTS.md`.

## First Chrome check

1. Update the existing extension and collect a known, unfiltered Hapana day.
2. Confirm the saved tutor table matches that day's tutor assignments. Check the save message says local and the portal connection is not active.
3. Reopen Daily Rolls, choose the saved date and confirm that the stored record remains available.
4. When making a real substitution for operational reasons, regenerate the rolls and check that the assignment updates and history records the change.
5. Export the schedule. It should contain tutor/session details and no student/contact/payment fields.
6. Check one tutor page and one crowded room hour in Chrome print preview before normal printing.

No real bookings, shift times or payroll data were changed while producing this package.
