# Success Tutoring Portal v1.6.52 - Final handover audit

This release is based on `v1.6.51-tutor-config-diagnostics` and includes a final stability, security, and handover audit pass.

## Main fixes and hardening

### 1. Private Google service account setup is safer
The portal now prefers `GOOGLE_SERVICE_ACCOUNT_JSON` over separate `GOOGLE_SERVICE_ACCOUNT_EMAIL` / `GOOGLE_PRIVATE_KEY` values when the JSON is present. This avoids the common setup issue where an old email or private key remains in Vercel and accidentally gets paired with a newer JSON key.

The JSON parser also accepts the common formats used in Vercel and `.env.local`, including raw JSON, quoted JSON, and accidentally escaped JSON.

### 2. New-centre campus defaults are no longer hardcoded to Parramatta
Tutor creation, tutor import, and tutor normalisation now use the configured first campus from `NEXT_PUBLIC_CAMPUSES_JSON`, such as `hornsby`, instead of defaulting to `parramatta`.

This makes new-centre setup much safer.

### 3. Login diagnostics retained
When no active tutors appear on the login page, the portal still shows safe diagnostic information so setup issues can be identified quickly, such as wrong tab name, wrong spreadsheet ID, service account access issue, no active tutors, or campusKey mismatch.

No secrets are shown.

### 4. Feedback and print logs use the authenticated campus
Feedback and print log APIs now prefer the campus stored in the login cookie over any client-supplied campus value. This prevents logs on a new centre from accidentally being recorded as Parramatta.

### 5. Print settings private-sheet saving is supported
The Print Colour Settings page can save through Private Google Sheets if configured, and no longer depends only on the old Apps Script webhook. Campus matching for print settings is case-insensitive.

### 6. Safer tutor management
The admin tutor API now blocks updates/imports/deactivations that would remove the last active admin for a campus. This helps prevent accidental admin lockout during handover.

### 7. Safer private-sheet updates
Private Google Sheet row updates now handle older headers and changed column order more safely by rewriting rows as objects when headers need to be upgraded.

### 8. Public diagnostics tightened
`/api/public-env` now returns only safe public setup status and does not expose secret values or secret presence checks.

### 9. Middleware auth check tightened
Protected pages now require `st_auth=1` exactly, rather than accepting any `st_auth` cookie value.

### 10. Print log columns improved
The private print log header set now includes a `Names` column, so printed material names can be stored separately as well as in raw JSON.

### 11. Handover env template added
A clean `.env.local.example` was added for new-centre setup. It contains placeholders only and no secrets.

## Verification performed

The following checks passed in the audit environment:

- `npm install --package-lock=false --prefer-offline --no-audit --no-fund`
- `npx tsc --noEmit`
- `npm run lint` (project script intentionally skips lint)
- TypeScript syntax check across all TS/TSX source files
- Runtime smoke checks for:
  - print colour rule resolution
  - member gender/email normalisation
  - tutor default campus from `NEXT_PUBLIC_CAMPUSES_JSON`
  - `GOOGLE_SERVICE_ACCOUNT_JSON` precedence over stale separate env vars
- `NEXT_TELEMETRY_DISABLED=1 NEXT_PRIVATE_BUILD_WORKER=1 npm run build`
- Final zip integrity check
- Package scan confirming `node_modules`, `.next`, package locks, and build cache files are excluded

## Required Hornsby-style setup example

Vercel env vars:

```env
NEXT_PUBLIC_CAMPUSES_JSON=[{"id":"hornsby","name":"Hornsby"}]
NEXT_PUBLIC_CAMPUS_NAME=Success Tutoring Hornsby

GOOGLE_SERVICE_ACCOUNT_JSON=...
GOOGLE_SHEETS_SPREADSHEET_ID=...

CONTACTS_SHEET_NAME=Contacts
CURRICULUM_SHEET_NAME=Subjects
TUTOR_CONFIG_SHEET_NAME=Tutors
FEEDBACK_LOG_SHEET_NAME=sentmsgs new
PRINT_LOG_SHEET_NAME=Print Log
PRINT_SETTINGS_SHEET_NAME=print_settings
```

The `Tutors` tab must include at least one active admin row for the selected campus:

```csv
campusKey,tutorName,role,active,email,campusName
hornsby,Madavan,admin,TRUE,,Hornsby
```

## Rollout note

Keep the old public CSV fallback env vars and published sheets available until the new private setup is tested end-to-end. After confirming login, feedback, progress, print, admin dashboard, members, tutors, logs, and print settings, the sensitive public sheet publishing can be removed.
