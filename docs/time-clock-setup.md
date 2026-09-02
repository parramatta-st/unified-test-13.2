# Time Clock / Payroll Hours setup

## Source of truth and storage model

The portal reuses its existing Google service account. Time Clock uses three
owned tabs, which are created with their headers automatically on first use:

- `time_clock_events` — append-only authoritative event ledger
- `time_clock_shifts` — generated current shift view
- `time_clock_adjustments` — generated admin audit view

Do not manually edit the event ledger. Each event has a server-generated hash;
an altered or incomplete event is excluded and shown to admins as an integrity
warning. Shift and adjustment tabs are rebuilt from the ledger after mutations,
so an accidental direct edit cannot silently change payroll.

Existing unrelated tabs are not deleted, renamed, reordered, or cleared.

## Required Vercel variables

Time Clock needs the same credentials already used by the portal:

```env
GOOGLE_SERVICE_ACCOUNT_JSON={...}
GOOGLE_SHEETS_SPREADSHEET_ID=existing_portal_spreadsheet_id
```

The older supported credential pair also works:

```env
GOOGLE_SERVICE_ACCOUNT_EMAIL=service-account@project.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```

If Time Clock should use a separate spreadsheet, share that spreadsheet with
the same service-account email as **Editor** and add:

```env
TIME_CLOCK_SPREADSHEET_ID=time_clock_spreadsheet_id
```

When `TIME_CLOCK_SPREADSHEET_ID` is absent, the existing
`GOOGLE_SHEETS_SPREADSHEET_ID` is used.

The confirmed Parramatta centre is **Suite 101, Level 1/7K Parkes St,
Harris Park NSW 2150**. Its verified building pin is:

```env
TIME_CLOCK_LATITUDE=-33.819078
TIME_CLOCK_LONGITUDE=151.0090804
TIME_CLOCK_RADIUS_METRES=150
```

The pin was cross-checked against the centre's official Google Maps listing and
the 7K Parkes Street property map. Set these values in Preview first. Add the
same values to Production only after the on-site phone test passes. Redeploy
after changing Vercel variables.

None of these variables should use the `NEXT_PUBLIC_` prefix. The browser sends
its one-time reading to the API, and the server calculates the distance from the
centre. The configured centre coordinates are never needed by client code.

## Optional safety and tab settings

```env
TIME_CLOCK_MAX_ACCURACY_METRES=200
TIME_CLOCK_LONG_SHIFT_HOURS=16
TIME_CLOCK_OPEN_SHIFT_ALERT_HOURS=12
TIME_CLOCK_EVENTS_SHEET_NAME=time_clock_events
TIME_CLOCK_SHIFTS_SHEET_NAME=time_clock_shifts
TIME_CLOCK_ADJUSTMENTS_SHEET_NAME=time_clock_adjustments
```

- GPS readings less precise than `TIME_CLOCK_MAX_ACCURACY_METRES` are rejected
  unless an admin uses a recorded override.
- Completed shifts at or above `TIME_CLOCK_LONG_SHIFT_HOURS` are flagged.
- Open shifts at or above `TIME_CLOCK_OPEN_SHIFT_ALERT_HOURS` are flagged.
- The starting geofence radius is 150 metres and remains server-configurable.

## Payroll rules

All calculations use `Australia/Sydney`, including daylight-saving changes.

- Monday–Friday before 7:00 PM: Normal Hours
- Monday–Friday from 7:00 PM: After 7 PM Hours
- Saturday at any time: Saturday Hours

The categories are mutually exclusive. A Friday 11:00 PM–Saturday 2:00 AM
shift becomes 1.00 After 7 PM hour and 2.00 Saturday hours.

No Sunday rate was supplied. Sunday time is therefore not silently put into a
weekday category: it appears as `unclassifiedHours`, is excluded from the three
main totals, and raises a visible payroll review flag. Configure a Sunday rule
before regularly rostering Sunday work.

Date-range totals are calculated from the part of each completed shift that
actually overlaps the selected Sydney date range. A shift crossing the first or
last midnight is split at the range boundary rather than assigned solely by its
clock-in date.

## Integrity and audit behaviour

- Clock-in and clock-out use server timestamps only.
- The signed session determines the actor, campus, and admin permission.
- The requested tutor is matched exactly against the active tutor config.
- Each browser operation has an idempotency key. Safe retries return the first
  result rather than creating another shift.
- The append-only ledger deterministically rejects a second simultaneous
  clock-in, stale admin edit, overlapping shift, or invalid clock order.
- Location is requested only when Clock In or Clock Out is pressed. There is no
  background or continuous location tracking.
- Admin location overrides require a reason and record the actor separately from
  the tutor whose shift is affected.
- Admin corrections and manual shifts require a reason and retain old/new times.
- Duplicate/error shifts are voided rather than deleted.
- Extremely long, open, future, overlapping, manually created, overridden, and
  unclassified-Sunday shifts are visible as review flags.

## Preview and physical test checklist

Before production promotion:

1. Add the Time Clock variables to the Preview environment.
2. Open the preview on a phone inside Success Tutoring Parramatta.
3. Allow precise location and clock in.
4. Refresh the page and confirm the green Clocked In state persists.
5. Clock out and confirm the correct tutor, actor, distance, and timestamp.
6. Test just outside the radius and confirm the normal action is rejected.
7. As an admin, test a written location override and another-tutor action.
8. Create, edit, and void a test shift; inspect its full adjustment history.
9. Verify a Friday-to-Saturday boundary and the three payroll columns.
10. Export the selected range CSV and compare it with the admin summary.

Browser geolocation can be spoofed by a deliberately modified device. It is a
practical attendance and audit control, not cryptographic proof of presence.
