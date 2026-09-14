# Time Clock / Payroll Hours — v1.7.0

## 14 September 2026 — combined payroll and release checks

- Combined weekday after-7pm and Saturday hours in the summary, shift detail,
  manual-entry preview, and CSV. Sum stored integer minutes before formatting.
- Prevent stale date-range exports during loading or after failed requests;
  show invalid-range errors and block exports when event integrity checks fail.
- Bound clock requests, preserve retry IDs, guard immediate double submissions,
  close successful clock actions immediately, and show a confirmation toast.
- Reject malformed location inputs and impossible explicit-offset calendar dates.
- Prevent a failed member-sheet read from being treated as an empty sheet during
  an upsert, avoiding destructive replacement on an upstream outage.
- Update Next.js, Nodemailer, cookie, and transitive PostCSS security patches;
  use Node.js 20.9+ (the current Vercel project uses Node.js 24).
- See `time-clock-release-verification-20260914.md` for evidence, limits, and
  the remaining checks required before wider access.

## 8 September 2026 — manual entries and payroll review

- Added a direct **Add manual entry** action to the main Time Clock window.
- Shared one-date, start/end-time form for manual entries and shift corrections,
  with instant duration/category preview and clear invalid-time errors.
- Removed the required reason for missed shifts; optional notes and automatic
  admin attribution remain audited. Corrections and live overrides retain reasons.
- Removed the hidden eight-character minimum that silently disabled saving a
  correction. Any nonblank written reason is accepted; save errors appear inside
  the dialog and a successful save closes it and refreshes payroll.
- Changed the default payroll range to the last 14 completed Sydney dates,
  excluding today, and compute it on page opening rather than at build time.
- Show the actual issue beside each flagged shift and explain how to resolve it.
  Manual/override audit information no longer flags valid hours as problematic.
- Include overdue open shifts in review counts without adding incomplete hours.
- Preserve historical ledger timestamps and existing cross-midnight calculations.

## Added

- Responsive Clock In / Clock Out control at the right side of the portal header
- One-time browser geolocation with server-side radius and accuracy checks
- Logged admin override and admin action-for-another-tutor flows
- Server-authoritative clock timestamps
- Append-only, hash-checked event ledger with idempotent request handling
- Materialised shift and adjustment tabs in the existing Google Sheets system
- Australia/Sydney payroll splitting for Normal, After 7 PM, and Saturday hours
- Correct cross-midnight, selected-range, and daylight-saving calculations
- Admin range view, tutor drill-down, location audit, notes, and CSV export
- Audited shift creation, correction, and non-destructive voiding
- Review flags for unusual, long, overdue open, overlapping, or Sunday shifts
- Automated unit tests for payroll boundaries, DST, range clipping, replay,
  concurrency, versioned edits, voiding, and event-integrity detection

## Reference implementation changes

The uploaded ZIP supplied the visual starting point. Its direct read/update
model was replaced because it could mistake a failed Sheet read for an empty
sheet, accept unvalidated target names, lose concurrent clock-outs, hide override
metadata in notes, and calculate date ranges using only the clock-in date.

The live repository remains the master version; no unrelated portal page or
service was replaced from the ZIP.
