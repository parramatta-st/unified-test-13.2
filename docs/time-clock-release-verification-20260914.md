# Time Clock release verification — 14 September 2026

## Scope and outcome

The current GitHub production source is the baseline, not the uploaded reference
ZIP. The payroll summary, individual shifts, manual-entry calculation preview,
and CSV now use Normal Hours and combined After 7 PM + Saturday Hours.
For example, 2 after-7pm hours plus 4 Saturday hours display as 6 combined hours.
The original separate minute fields remain available in stored shift/audit data.
No spreadsheet tabs, headers, existing shifts, or environment values were changed
by this release work. Existing payroll categories are combined before rounding.

## Verification performed

- 45 automated tests pass, including the actual clock/admin API handlers against
  an isolated simulated Google Sheets transport. All test identities, credentials,
  and records are synthetic; these checks do not create live payroll entries.
- Clock-in/out use server timestamps, persist through a fresh status request,
  reject a second active shift and clock-out without a shift, and replay a retry
  without duplicating it. Concurrent duplicate submissions are checked.
- Tutor access, admin-only actions, actor attribution when clocking another tutor,
  written location overrides, out-of-radius readings, poor accuracy, and malformed
  coordinate inputs are checked. Modified/expired sessions are rejected.
- Manual entries, edits, short written correction reasons, adjustment history,
  version conflicts, overlapping shifts, voided shifts, ledger integrity, and
  failure-safe Sheets reads are covered by the suite.
- Payroll checks cover 7pm, Saturday precedence, Friday midnight, date-range
  clipping, Sydney daylight saving, impossible dates, last-completed-fortnight
  selection, and rounding from integer minutes. CSV formulas/quoting are checked.
- Client-state tests check stale status handling. Request tests check timeouts,
  unreadable responses, and absence of automatic duplicate writes. These are
  automated code-level checks, not proof of real-phone browser behaviour.
- Eighteen protected portal API handlers reject unauthenticated access without
  making upstream calls. A failed member-table read does not overwrite data.
- Nodemailer composes a message using its in-memory stream transport. No email
  was delivered and no physical print job was submitted.
- TypeScript checking and the optimized production build pass on Next.js 15.5.25.
  The repository's lint command explicitly skips linting because no ESLint
  configuration exists; this is not recorded as a clean lint scan.
- `npm audit --omit=dev` reports zero known vulnerabilities after the dependency
  updates. This checks published dependency advisories, not application security.

## Wider rollout blockers and limitations

**Authentication needs a separate follow-up before broader access.** Individual
staff identity, administrator access, and prompt account revocation require
further work. The specific findings are reported directly to the centre manager.
Authentication behaviour was not silently changed in this payroll update.
Live SESSION_SECRET configuration was not inspected. Passwords and signing keys
must remain in private server configuration.

Protected browser interactions still require an authenticated test session. The
available hosted browser reached the sign-in screen, and local-browser access was
blocked by the browser environment. Real iPhone/Safari scrolling, tab navigation,
geolocation permission prompts and indoor accuracy were not verified in this run.

Google Sheets permissions, service-account writes, quota behaviour under realistic
staff load, and independent concurrent server instances still need staging checks
with designated test data. The ledger detects conflicting events; its generated
views are not database transactions. Its event hash detects ordinary corruption,
not malicious rewriting by someone with direct spreadsheet editing access.

Sunday time remains explicitly unclassified and flagged because no Sunday rule
has been supplied. Open shifts contribute no completed payroll hours. Browser
location is an attendance aid, not cryptographic proof of physical presence.

## Before staff handover

1. Complete the staff identity/admin access follow-up and confirm SESSION_SECRET.
2. On a real phone at the centre: clock in, switch portal/browser tabs, refresh,
   confirm the active header state, clock out, and check the saved audit record.
3. Check outside-radius rejection and permission-denied messaging, then a written
   admin override and admin action for a designated test tutor.
4. Add a test manual entry, save a correction, inspect old/new times, and void the
   test record through the UI so its audit trail remains visible.
5. Check mobile page tops, the clock dialog, long names, and the on-screen keyboard.
6. Export the last 14 complete Sydney dates and reconcile the two hour columns
   with the shift details before using the export to process payroll.
7. Verify Feedback/Inbox with a designated test recipient, Progress with a test
   student, and Print with the centre printer. No real parent messages or print
   jobs were sent as part of this automated review.

This is a tested maintenance release with explicit remaining launch checks, not
a certification that every production integration or browser is error-free.
