# Hapana / Time Clock integration — staged implementation

Prepared 12 October 2026. Part 1 is implemented in this package. Parts 2 and 3 below describe the remaining work; their tables, routes and controls have not been created.

## Confirmed production source

The time clock is in `parramatta-st/unified-test-13.2`, main commit `1097c9f8443d824a2307e22a836b7c76e081f83a`. Vercel's latest production deployment for `unified-test-13-2` reported the same commit and READY status. This establishes source alignment, not a runtime test of the signed-in portal.

The separate repository `parrasuccess-blip/success-tutoring-unified-portal` has no time-clock files in the inspected main commit `dc8e29642a9e9f14eacc13b46efd8583b43c567c`. Vercel denied deployment inspection for that separate project; it is not the basis for this integration plan.

Inspected time-clock files: `docs/time-clock-setup.md`, `lib/timeClock.ts`, `lib/timeClockCore.ts`, `lib/timeClockReview.ts`, `lib/timeClockPayroll.ts`.

The current time clock uses an append-only `time_clock_events` ledger and generates `time_clock_shifts` and `time_clock_adjustments`. Its spreadsheet is resolved by `timeClockSpreadsheetId()`: `TIME_CLOCK_SPREADSHEET_ID` when configured, otherwise the existing portal Google Sheets spreadsheet. Reuse this spreadsheet and service account for schedule data, in separate tabs. No credentials belong in the extension.

Existing source defaults/documentation use separate completed/open duration thresholds and `>=` comparisons. There is no shift-approval action identified in the inspected event model. Merely setting both environment values to 8 is therefore not the complete agreed feature: review boundary, explicit approval, audit and payroll gating also need code changes.

## Part 1 — delivered

Hapana Day → verified per-session collection → tutor-only field whitelist → worker-local record → saved table/history/export.

The collector stores start/end as minutes after midnight on a Sydney calendar date. Example: 4–5 pm = 960–1020. It does not assume a permanent UTC+10 or UTC+11 offset. The portal must convert using its existing `parseSydneyDateTime` machinery and reject nonexistent or ambiguous wall times rather than guessing.

The current extension's network policy continues to block external transfers. Local success messages explicitly say the portal connection is inactive. Part 1 cannot raise portal alerts or change shift review/payroll status.

## Part 2 — central schedule storage and authenticated connection

Proposed tabs in the existing time-clock spreadsheet:

| Tab | Purpose | Key fields |
| --- | --- | --- |
| `hapana_schedule_events` | Append-only source records and import commit markers | eventId, importId, campusKey, date, eventType, serverAt, actorId, captureToken, sessionId, payload, integrityHash |
| `hapana_schedule_sessions` | Generated current expected tutor/session view | campusKey, date, sessionId, tutorId, tutorNameRaw, startAt, endAt, state, sourceImportId, updatedAt |
| `hapana_tutor_mappings` | Explicit Hapana-name → portal-tutor mapping | campusKey, normalisedHapanaName, tutorId, active, updatedBy, updatedAt |

Table names are proposed defaults, not tabs already created. This is consistent with the current event-ledger pattern and avoids treating generated rows as authoritative payroll data.

### Import commit and concurrent updates

An authenticated admin starts collection through the portal connection and receives a server-issued capture token/base schedule revision. The server derives campus and actor from the signed-in session and checks admin rights; it does not accept those privileges from the payload. The extension can use a scoped revocable pairing credential held in extension storage, never a Google service-account key or a credential injected into the Hapana page. The final transport and pairing flow must be verified on the actual portal origin before enabling uploads.

Session rows are appended for one import, followed by a commit event with expected count and integrity digest. Replay only a complete, committed import whose unique session IDs, counts and digest agree. An interrupted import remains inactive; retain the prior committed schedule. Safe retries use the same import ID. Derive the latest accepted schedule deterministically from the ledger; do not overwrite shared rows in a read/modify/write race.

Freshness across browsers must use server capture ordering and base revisions. Part 1's client `startedAt` is only a local concurrency safeguard, not a trusted server clock. Reject stale imports that would reverse newer substitutions. Refresh generated views from the latest ledger, never from a request's old cached snapshot. Reuse the existing integrity and replay design after inspecting its ordering conventions in detail.

Preserve exact-date boundaries. A full-day replacement affects only that campus/date. Conservative updates change only observed session IDs; unseen sessions remain with their original observation timestamp and must be labelled potentially stale. A fully confirmed replacement can remove missing sessions while retaining the source history. A completely cancelled day needs an explicit verified cancellation operation; the current collector cannot prove an empty day.

### Tutor identity and freshness

The display name is normalised only for whitespace and recognised trailing substitute status. Every unmapped or ambiguous name appears as a data issue for the admin. Suppress the missing-shift accusation for that session until its tutor is resolved. Mapping to a different tutor must clear the old tutor's derived alerts. Include campus in matching and never match by first name alone.

Show last successful sync, its date, collection completeness, exclusion count and unresolved mappings in the portal. A local export is not a live-sync acknowledgement. When collection or upload fails, show the failure and retained last-good data. Never imply that a day is fully checked when its schedule has not been imported.

The routine remains user-triggered: rerun Daily Rolls after substitutions, cancellations or tutor changes. No unattended Hapana access is included. All assessment/one-to-one exclusions must remain visibly stated; extending that coverage requires additional collection work.

## Part 3 — alerts, eight-hour review and approval

### Missing clock-in

For each expected session with a resolved tutor, begin checking at `sessionStart + 20 minutes`, using server time. Match a non-void shift for the same campus and stable tutor ID that actually overlaps the scheduled interval. Open shifts use the current time as their provisional end, never infinity; a current open shift can count as clock-in evidence. Ignore invalid or future intervals. An overdue prior-day open shift also produces its own eight-hour review flag, so it is not silently treated as healthy.

An interval ending exactly at the class start or starting exactly at the class end has no positive overlap. Late clock-in during the session counts and clears the warning. One longer shift can cover several classes. No late-arrival, early-departure or scheduled-finish clock-out warning is added.

Group unresolved sessions by tutor in the top Time Clock Alerts panel, listing affected session times. Link to that tutor's records and existing manual-entry correction controls. Changes to the schedule, shift or mapping recalculate alerts, including removal of Kevin's warning when Aryan replaces him. Do not automatically create or alter shifts.

### More than eight hours

Use exact elapsed milliseconds: `elapsed > 8 * 60 * 60 * 1000`. Exactly eight hours is not over the limit; eight hours plus one second is. Make eight hours the default configurable review threshold, apply it equally to open and completed shifts, and use wording reflecting “more than” rather than the existing “at least”.

| Shift | Result |
| --- | --- |
| Open, elapsed ≤ 8 hours | No duration review warning |
| Open, elapsed > 8 hours | Potential missing clock-out; admin review; no payroll hours |
| Completed, duration > 8 hours, unapproved | Needs review; excluded from payroll-ready export |
| Completed, duration > 8 hours, explicitly approved | Payroll-ready if no other blocking flags |
| Approved times are subsequently changed | Prior approval is invalidated; re-review required |

Add an append-only admin approval event to the existing time-clock ledger, bound to the exact shift revision and clock-in/out values. Record actor, server timestamp and approved values. Ordinary clock-out must not count as approval of a long shift. An open shift needs a real end time before approval; it must never be automatically closed at eight hours.

Review flags need per-reason resolution. Approval of a long duration must not waive overlaps, invalid timestamps, integrity failures or other unrelated blocking issues. The admin view should separate provisional hours from payroll-ready totals, and the CSV/export boundary must independently enforce gating on the server. Keep integer minute calculations and the existing premium-hours combination.

Eight-hour reviews do not depend on Hapana schedule availability. They must still work on an admin/manual or NFC shift even if no rolls were generated that day. Recalculate open-shift age on API reads and periodic visible-page refresh; avoid a cached flag staying unchanged past the threshold. No scheduled-class-finish alert is needed.

## Remaining verification before release

Use the verification skill's boundary approach: extension trigger → authenticated request → committed ledger → replayed session view → shift comparison → alert display → admin action → payroll export. Verify each boundary with synthetic data first, then a signed-in preview with authorised test records.

Test server auth/campus isolation; expired pairing credentials; partial uploads; replay/idempotency; old captures finishing late; two browsers; full-day deletions; unknown/duplicate tutor names; manual/NFC/voided shifts; 19:59 versus 20:00 grace boundary; zero-overlap boundaries; exact eight hours and one second over; open-shift ageing; approvals invalidated by corrections; payroll CSV gating; Sydney daylight saving; and alerts clearing automatically.

Do not promote until preview behaviour and real Chrome collection/printing are checked. Part 1's 77 automated passes do not certify those portal behaviours.
