# Time Clock / Payroll Hours — v1.7.0

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
- Review flags for unusual, long, open, overlapping, overridden, or Sunday shifts
- Automated unit tests for payroll boundaries, DST, range clipping, replay,
  concurrency, versioned edits, voiding, and event-integrity detection

## Reference implementation changes

The uploaded ZIP supplied the visual starting point. Its direct read/update
model was replaced because it could mistake a failed Sheet read for an empty
sheet, accept unvalidated target names, lose concurrent clock-outs, hide override
metadata in notes, and calculate date ranges using only the clock-in date.

The live repository remains the master version; no unrelated portal page or
service was replaced from the ZIP.
