# Success Tutoring Daily Rolls — v0.3.5

Open **START-HERE.html** for installation and daily-use instructions. Load the folder containing manifest.json as an unpacked extension in Chrome. No build step or dependencies are required.

## Updating from an earlier version

Copy all files from this package's hapana-rolls folder into the permanent folder already loaded in Chrome, including launcher.js. Reload the extension at chrome://extensions, close the old review tab and refresh every open Hapana tab. The version should read 0.3.5. Generate a fresh roll from Daily Rolls beside Reports.

## Changes in this version

- Room-roll pagination is back to the **v0.3.2-style behaviour** for ordinary hours: names stay at the selected 18 / 22 / 26 pt maximum and pages continue naturally.
- If **two or more classes start at the same time in the same room**, that time slot is kept together instead of being split across two A4 sheets.
- When that simultaneous time slot cannot fit at the selected size, **only that hour block** reduces to the largest student-name size that fits on one sheet.
- Earlier and later hours in the same room remain at the selected maximum size; the whole room is no longer reduced just because one hour is crowded.
- Screen layout, print colours, headings, room-assignment controls, tutor rolls and the automatic **Room 2 >= Room 3 >= Room 4** suggestions are unchanged.

## What changed in v0.3.5

This corrects the v0.3.4 interpretation of shared-room fitting. The fitting scope is now the simultaneous **hour/time slot**, not the whole room. For example, if a Room 2 roll has normal 4–5 pm and 6–7 pm sections but two 5–6 pm classes would otherwise split across pages, only the 5–6 pm block is kept together and reduced as much as necessary. The surrounding hours keep the chosen maximum room-roll text size.

## Retained from v0.3.4

The measured fitting routine still finds the largest room-name size that fits, capped by the selected 18 / 22 / 26 pt setting. v0.3.5 applies that existing fitter only to a crowded simultaneous time block rather than to all classes in the room.

## Retained from v0.3.3

- Automatic K–6 room suggestions prioritise booking counts for classes that start at the same time: larger classes go into the lower-numbered primary rooms so the usual order is **Room 2 >= Room 3 >= Room 4**.
- Shared rooms, manual room changes, Room 1 senior defaults, unknown-class manual choices and collection behaviour are unchanged.

## Retained from v0.3.1

- Tutor grouping recognises trailing `(sub)` and `(substitute)` labels as the same tutor. All their classes go into the existing one-page-per-tutor layout.
- Trims excess whitespace and ignores capitalisation for grouping. Other name annotations and different surnames stay distinct; no fuzzy name matching.
- The original instructor label, individual sessions, student bookings and room assignments remain intact. Only tutor grouping and its page heading are normalised.
- Regression tests cover the reported 6 + 7 + 5 bookings across Aryan's three classes, and one-page preview/print rebuilding with mixed regular/substitute entries.

## Retained from v0.3.0

- Removed the bottom-right overlay; Daily Rolls is a small native-style menu item after Reports. Accounts without Reports use the end of the same main menu.
- The schedule header is sticky and stays in document flow while scrolling. Its stacking level (1000) is below the inspected Add Clients backdrop (1039) and panel (1040). Dialogs deliberately cover the background menu until dismissed.
- Launcher placement survives delayed/replaced navigation, does not duplicate on remount, follows the native collapsed menu, prevents repeated launch clicks and shows a recovery message if Chrome invalidates the extension context.
- No fallback floating control is created if Hapana changes its header structure. Chrome's extension toolbar action remains available.
- Room assignment, collection, privacy and print output are unchanged from v0.2.0.

## Retained from v0.2.0

- Screen styling follows [Unified 13.2](https://github.com/parramatta-st/unified-test-13.2), inspected at commit `601d3effbda68e548b300fd110c1b788f0a80e8b`: dark glass panels, rounded controls, orange primary actions and cyan accents.
- White print pages use Success Tutoring blue (`#31c8ff`) and orange (`#ff7a18`).
- Each tutor's entire day stays on one A4 page. Compact font/spacing profiles are measured in the rendered page, then the full content is scaled further if necessary. No student rows are omitted. Unusually small names are flagged in preview.
- Room sheets retain their independent 18/22/26 pt name-size setting. Simultaneous classes in the same room are kept together for that time slot; ordinary room pagination otherwise remains independent. A single unusually long class can still continue onto another sheet. Room choices and collection behaviour are unchanged.

## Scope

Read-only collection of the selected Hapana Day view at Parramatta; exclude assessments and one-to-one; editable whole-class room assignment; simultaneous shared rooms; student-facing room rolls and private tutor rolls. No locked assignments, individual-student overrides, saved room preferences, portal integration or scheduled unattended collection.

## Implementation

- `reader.js`: pure DOM extraction grounded in Hapana's inspected `#getdaymyEvents`, `#eventLoad` and `#attendeesList` structures. Separates dated session identities, deduplicates desktop/mobile rows, validates counts, instructor, campus, date and time.
- `content.js`: isolated-world read-only request handler and launcher wiring. No private API probing or credentials/cookie access.
- `launcher.js`: native menu item, scoped sticky header and idempotent navigation remounting. Does not edit Hapana forms or save controls.
- `background.js`: opens review/collector tabs, validates navigation URLs, tracks only extension-owned collector tab IDs in session storage, closes only those tabs.
- `review.js`: sequential collection with a 45-second per-class deadline, stable-result check, cancellation/retry, room editing, in-memory data, same-hour room grouping/fitting, ordinary room pagination and single-page tutor output.
- `model.js`: pure room suggestions, room grouping and readiness checks.
- `review.css`: responsive screen and A4 print styles. No remote fonts or assets.
- `portal-theme.css`: screen-only theme matching Unified 13.2.
- `print-upgrade.css`: white-paper brand styling and compact tutor layouts, with identical preview/print metrics.
- `print-fit.js`: measured fitting of tutor pages plus maximum-name-size fitting for crowded simultaneous room-hour blocks.
- `START-HERE.html`: user guide with a clearly labelled fictional sample mode.
- `tests/`: dependency-free unit checks and synthetic DOM fixtures. No real students or credentials are in the package.

## Security and privacy

Manifest V3, only the storage permission and the `https://core.hapana.com/*` host permission. No broad tabs, cookies, history, debugger, scripting or downloads permissions. Host access allows content scripts and messaging on Hapana; reading credentials is not implemented. No `fetch`, XHR, analytics, remote executable code or external student-data transfers. All HTML containing Hapana values is built with textContent, not interpolated HTML. Requests to existing session links happen through ordinary Hapana navigation, using the user's existing session. The extension neither submits forms nor clicks account-editing controls.

Student data and room assignments remain in the review tab's memory. They are lost on refresh/close. Chrome session storage contains only owned collector IDs for cleanup. A user-saved PDF or paper copy is outside that in-memory lifecycle. Staff phone/payment columns can be disabled independently; student room printouts never include them.

## Verification boundary

See TEST-RESULTS.md for exact checks. The user reported v0.2.0 working. During this update, Hapana's native header scrolling and Add Clients structure/layers were inspected in the live browser without changing bookings. The browser cannot run the local extension here; no attempt was made to bypass that restriction. The v0.3.0 installed sticky/menu behaviour therefore still requires the short user-side update check. Synthetic DOM/style tests are not evidence of actual rendering or hit testing.

## Development

Run `node tests/run.cjs` from this folder for pure logic, synthetic DOM extraction, worker-boundary and package-safety tests. The files load directly as classic extension scripts. The extension service worker uses importScripts for the shared pure reader. UI samples use fictional names only.

## First-run acceptance checklist

For this update, first confirm Daily Rolls sits beside Reports, remains reachable after scrolling the day, stays underneath Add Clients, and does not block its save/add/cancel controls. Open and cancel the panel without selecting students, then launch Daily Rolls. Check a narrower window with the native navigation toggle as well.

1. Install, refresh Hapana, open a known day and clear filters.
2. Confirm discovery totals against the sidebar and that excluded classes are only assessments/one-to-one.
3. Compare all included class names, tutors, times and student counts with Hapana; spot-check actual names, especially duplicate-looking classes at the same time.
4. Place two classes with the same start time in the same room. If they would normally split across sheets, both must stay together on one sheet; surrounding hours must keep the selected maximum text size.
5. Assign an unknown type such as Selective manually. Change and clear room choices; no choice is locked.
6. Check a class above capacity produces an informational note, not a room-sharing blocker.
7. Test cancellation/retry; incomplete rolls must remain blocked.
8. Preview room-only sheets: no phone/payment data or attendance column. Preview staff sheets with each optional field on/off.
9. Preview the busiest tutor's day and confirm exactly one page, all classes/students present, and readable long names. Print at A4/portrait/100%, single-sided, headers/footers off, colour and background graphics on. Room sheets can span multiple pages.
10. Recollect after a booking change. Confirm the refreshed count/name and deliberate reset of room choices.
