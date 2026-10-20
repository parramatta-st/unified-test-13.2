# Verification — v0.4.0 — 12 October 2026

Story: generate Daily Rolls → fully verify class details → project tutor-only capture → save through extension worker → render durable schedule/history/export.

## Executed checks

| Suite | Passed | Evidence |
| --- | ---: | --- |
| Existing regression suite | 44 | `node tests/run.cjs` exited 0 |
| Schedule model and real worker handler | 22 | `node tests/schedule-unit.cjs` exited 0 |
| Review/controller flow with simulated DOM and Chrome APIs | 11 | `node tests/schedule-flow.cjs` exited 0 |
| Total | **77** | All three suites passed after final code changes |

The worker tests exercise the actual message handler with simulated storage. The flow tests execute actual review/controller code with simulated DOM and Chrome APIs. Neither is a real browser.

## Verified cases

- Tutor substitution changes one stable session; before/after tutor history is preserved.
- Filtered views keep unseen classes; a confirmed full day removes disappeared classes.
- Missing/duplicate sessions, malformed times/dates, unassigned tutors and invalid campuses are rejected.
- Failed/stopped/demo collections never write a schedule.
- A failed new day read cannot re-stamp old displayed classes through manual save retry.
- Concurrent worker writes are serialised. Old-start collections cannot reverse newer assignments.
- Capture retries do not duplicate revisions. Reusing an ID with changed data fails.
- Worker restart retains stored data in the simulated durable store.
- Failed storage writes preserve prior data, show an error, allow retry and do not prevent printing verified rolls.
- Saved-date view works independently of the current collection.
- Student/contact/payment/room/URL fields are excluded from every saved capture and history.
- Read-only host scope, existing launch/menu behaviour, room suggestions, substitute grouping and print-model checks pass.

## Browser and deployment boundary

The real Chromium test could not launch: the installed Playwright package had no Chromium executable or headless shell. No browser scenario is marked passed and no browser screenshot was produced. `tests/browser-schedule.cjs` remains available to execute in an environment with Playwright and Chromium installed; its fictional Hapana routes avoid changing live bookings.

Physical print layout, Chrome extension reload persistence, actual Hapana account DOM and download permission behaviour require the short Chrome check in README.md. The v0.4.0 schedule panel has not been visually rendered in this environment. Screen CSS was checked against the existing dark theme, and styles were added there to keep the new panel's text and background consistent.

Vercel reported READY production deployment `dpl_6hF3pA9a7UtV31ueYnqZGe4w2M4y` of `unified-test-13-2` at commit `1097c9f8443d824a2307e22a836b7c76e081f83a`, matching the inspected source. This is source/deployment metadata verification only. The portal was not modified, deployed or functionally tested in this part.

No central schedule tables, upload credentials, missing-clock-in alerts, eight-hour reviews or approval events have been installed. The integration plan describes those next parts.

## Historical evidence

`TEST-RESULTS-v0.3.5.md` and `CHANGELOG-v0.3.5.md` describe the supplied previous release. Their release statements and earlier browser observations must not be treated as v0.4.0 validation.
