# Verification record — v0.3.5

## Version 0.3.5 — 23 September 2026

This update corrects the fitting scope from v0.3.4. Room rolls now retain the v0.3.2-style pagination for ordinary hours. When two or more classes in the same room start at the same time, that simultaneous time block is kept together. If it would not fit at the selected 18 / 22 / 26 pt room-roll size, only that time block is reduced to the largest student-name size that fits on a fresh A4 page. Earlier and later hours in the same room remain at the selected maximum size.

Command: `node tests/run.cjs` — **44 tests passed**. The room-print regression now forces a crowded simultaneous hour, verifies both classes stay together on one page, verifies only that hour receives a reduced local name size, and verifies the later hour in the same room remains outside the reduced wrapper at the selected maximum. Existing collection, privacy, room suggestions, tutor fitting, substitute grouping and launcher tests also pass.

No CSS or HTML layout files were changed in v0.3.5. The visual design, print colours, headings and controls are unchanged. Synthetic geometry verifies the pagination/fitting decisions, but the final acceptance check remains Chrome A4 preview of the real busy hour that previously split in v0.3.2.

## Earlier v0.3.4 verification

## Version 0.3.4 — 23 September 2026

This update changes only shared-room print fitting plus version documentation/tests. Shared rooms remain one A4 door sheet. A crowded shared room now reduces only its own student-name size, using the largest size that fits up to the selected room-roll maximum; other room sheets remain at the selected size. Existing colours, layout, room assignment logic, tutor rolls and Hapana collection behaviour are unchanged.

Command: `node tests/run.cjs` — **44 tests passed**. The new fitting regression checks that a crowded shared room converges on the largest fitting name size while another shared room that already fits stays at the full selected size. Existing collection, privacy, room suggestions, tutor fitting, substitute grouping and launcher tests also pass.

No CSS or HTML layout files were changed in v0.3.4. The fitting tests use synthetic page geometry rather than Chrome's physical print renderer, so the final user-side check remains a normal A4 preview/print of a busy shared room.

## Version 0.3.3 — 23 September 2026

This update is limited to room-sheet printing. If a room contains two or more classes, `review.js` now builds all of those class sections inside one room page and proportionally scales that combined content only when the normal layout would overflow. This keeps the existing headings, colours, tables and student ordering while ensuring the room's door list is one sheet. A room with only one class retains the previous continuation/pagination behaviour for unusually long lists.

No room-assignment logic, collection logic, tutor grouping, screen UI or print styling files were changed. The v0.3.2 **Room 2 >= Room 3 >= Room 4** suggestion behaviour is retained.

Command: `node tests/run.cjs` — **43 tests passed**. The shared-room UI fixture now forces an overflow condition and verifies that three classes assigned to Room 1 remain together on one Room 1 page and that the combined room content is scaled rather than split. Existing room privacy, tutor one-page fitting, substitute grouping, launcher, collection and permission checks also pass.

Actual Chrome/PDF printer pagination is not rendered by these synthetic tests. The user-side check for this version is: assign two ordinary classes to one room, preview room rolls, and confirm both labelled class sections appear on the same A4 door sheet at a readable size.

## Earlier v0.3.2 verification

## Version 0.3.2 — 21 September 2026

This update changes only the automatic K–6 suggestion order, plus version/documentation/tests. For K–6 classes with the same start time, booking count is now used as a tie-breaker before room placement. Because the existing placement rotates overlapping classes through Rooms 2, 3 and 4, larger same-time classes are placed first, producing the usual ordering **Room 2 >= Room 3 >= Room 4** while preserving shared rooms and manual overrides.

No CSS, HTML layout or print-layout logic was changed. Room 1 senior defaults, unknown-class manual choices, collection, tutor grouping, privacy and printing are unchanged.

Command: `node tests/run.cjs` — **43 tests passed**. A new regression test checks six simultaneous K–6 classes with booking counts 10, 9, 8, 7, 6 and 5; suggested room totals must be Room 2 = 17, Room 3 = 15 and Room 4 = 13.

## Earlier v0.3.1 verification

## Version 0.3.1 — 14 September 2026

Inspected the uploaded PDF's pages 11 and 12 visually and by text extraction. The headings are `Aryan Gupta` and `Aryan Gupta (sub)`. The first page has 4 pm and 5 pm classes (6 and 7 bookings); the second has his 6 pm substitute class (5 bookings). The old model grouped exact instructor strings, creating two tutor groups before pagination ran.

The model now strips only recognised trailing substitute status labels for tutor grouping and retains the original session data. All three classes form one group with 18 bookings. The existing one-page tutor fitting is unchanged.

Command: `node tests/run.cjs` — **42 tests passed**. New checks verify all 18 bookings and chronological class order, preservation of original room/session labels, conservative name matching, and a mixed regular/substitute preview yielding one tutor page through print rebuilding. Existing collection, launcher, privacy and print-fit checks pass.

This is a grouping fix. New extension pages were not browser-rendered here; the previously documented local-extension browser restriction remains. The uploaded PDF is evidence of the old split, not a rendered output of the fix. No real student names or contacts were added to the code or fixtures.

## Earlier v0.3.0 verification

Date: 12 September 2026. The user reported v0.2.0 working in their installed Chrome. This update changes only the Hapana launcher and schedule-header behaviour, plus documentation/tests.

## Version 0.3.0 checks

Command: `node tests/run.cjs` — **39 tests passed** (the previous 26 plus 13 launcher checks).

Live read-only inspection:

- Confirmed Reports is a direct item in `#hedderNav #navbar > ul.navbar-nav`, inside a header that is a direct body child.
- Scrolled the native page: the header moved from top 0 to -261 px, confirming it currently scrolls out of view. The new stylesheet uses sticky positioning on that header, not on an element constrained inside it.
- Confirmed 539 px of free navigation space after Reports at the inspected 1363 px viewport.
- Opened Add Clients without selecting any student. Its footer button was labelled Add in this session (the user's screenshot showed the corresponding save area). Inspected the panel's stacking level of 1040 and backdrop of 1039. The new sticky header uses 1000, underneath both.
- Cancelled the panel without saving or changing a booking and restored the page to the top.

New automated checks use a non-rendering fixture matching that header structure:

- Correct native menu placement, no duplicate controls/styles/observers on repeated mounts.
- Delayed navigation, header replacement, and accounts without Reports.
- Sticky/no-fixed-overlay stylesheet contract; dialog stacking; native collapsed-menu and print rules.
- Opening a panel preserves its form controls and does not move the launcher into it.
- Mouse/Space activation, default navigation prevention and no form submission.
- Repeated-click protection, rejected/error-response handling and recovery.
- Removing the old extension-owned overlay, cleanup when leaving Schedule, manifest script order and preserved read-only reader responses.

The new installed extension was **not** rendered here. The existing browser policy blocks local extension pages; no alternate rendering path was used to bypass it. Automated CSS contracts and synthetic events cannot prove actual sticky positioning, responsive rendering or hit testing. The user-side update check is: scroll a day to the bottom, open/cancel Add Clients, confirm its controls are clear, launch Daily Rolls, and check a narrower window.

## Earlier version 0.2.0 checks

Command: `node tests/run.cjs` — **26 tests passed**.

- The sample day creates exactly four tutor pages for four tutors, with all seven classes and 32 bookings retained.
- Under deliberately constrained synthetic geometry, the output still contains four tutor pages and all 32 bookings; each tutor's content is scaled and the dense-day notice appears.
- Returning to normal geometry clears the dense-day notice. Browser beforeprint rebuilding does not duplicate tutor pages or class sections.
- Fitting selects the largest compact profile that fits, resets previous transforms and bounds content in both dimensions, including very tall/wide cases.
- Invalid/zero-size measurements fail explicitly instead of silently producing a clipped tutor roll.
- Existing collection, room sharing, room-print privacy, optional staff columns and permission-boundary tests continue to pass.

The geometry tests use non-rendering fixtures. They do not test actual CSS layout, fonts, printer margins or physical readability. Check the busiest tutor's A4 preview and one printed page at 100% scale, single-sided, with colour/background graphics on.

## Earlier v0.1.0 live, read-only Hapana checks

The same pure DOM reader shipped in this package was evaluated on authenticated Hapana pages without clicking booking/attendance actions or exporting real student data into this package.

| Check | Observed result |
| --- | --- |
| Selected day discovery | 12 September 2026; 13 visible sessions; 10 group classes included; 3 assessment/one-to-one sessions excluded |
| 10 am Years 7–10 English | 5 booked, 5 unique students read; tutor and visible phone fields read |
| 10 am K–6 English | 7 booked, 7 unique students read; tutor read |
| First noon K–6 English session | 6 booked, 6 unique students read; correct session identity and tutor |
| Second noon K–6 English session | 6 booked, 6 unique students read; a different session identity and different tutor from the first |

Hapana includes a desktop row and a mobile row for each attendee. The reader uses the structured desktop rows and deduplicates by the opaque client identifier, not by student name. Tests confirmed the count rather than relying on screenshots or OCR.

Not all ten included classes were read in this verification pass. The first installed run must verify the full selected day.

## Earlier v0.1.0 automated checks

Command: `node tests/run.cjs`

Result: **22 tests passed.** These dependency-free tests cover:

- Date/time parsing and midnight/noon handling.
- Assessment spelling variants and one-to-one exclusions.
- Narrow read-only URL validation; cross-origin and mismatched-date rejection.
- Synthetic day and session DOM extraction.
- Responsive duplicate rows and identical names with distinct IDs.
- Partial student lists rejected; loaded empty lists accepted.
- Above-capacity class warning without blocking room sharing.
- Incorrect date, identity and campus rejection.
- Simultaneous same-name sessions staying distinct.
- Loading/stale day lists rejected.
- Senior/primary room suggestions, simultaneous sharing, and unknown-type manual choices.
- Print readiness gates for errors, ongoing collection and unassigned rooms.
- Independent tutor/room grouping.
- Manifest permission scope and absence of remote-transfer/unsafe-HTML code paths.
- Service-worker caller validation and cleanup of only owned collector tabs.
- Non-rendering review-event tests for room selection/sharing, clear/suggest, room-vs-tutor privacy, optional phone/payment columns and rebuilding print content without duplicates.

## Important unverified boundaries

The cloud browser rejected opening the local extension page under its URL security policy. No alternate browser or indirect execution was used to get around that restriction. UI logic was tested using a small non-rendering in-memory fixture, which is **not** evidence of correct browser rendering.

These checks therefore remain for the user-side pilot:

1. Loading the unpacked extension in real Chrome and showing the Hapana launch button.
2. End-to-end extension messaging, inactive-tab navigation and collection timing.
3. Actual mouse drag-and-drop and keyboard/screen-reader behaviour.
4. Real CSS layout, A4 pagination, long-name wrapping and printer margins.
5. Live cancellation/retry, expired-login behaviour and mid-collection booking changes.

Use START-HERE.html and the acceptance checklist in README.md. Compare the first generated day against Hapana and test one physical page before regular use.
