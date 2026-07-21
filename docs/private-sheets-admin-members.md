# Private Google Sheets + Admin Members/Tutors Upgrade

Version: 1.6.46-private-sheets-fixes

## What changed in v1.6.46

This update fixes the first round of private Sheets/member-management issues found during testing.

Fixes included:

- Added support for `GOOGLE_SERVICE_ACCOUNT_JSON`, so you can paste the whole downloaded service-account JSON into Vercel instead of copying the email/private key separately.
- Added clearer Google Sheets connection errors, especially for `Invalid grant: account not found`.
- Added `/api/admin-sheets-status` and a **Check Sheets** button on Members/Tutors pages.
- Fixed old contact gender values like `M` and `F`; they are now accepted and normalised to `male` / `female`.
- Fixed the “Gender must be male or female” error when editing older members.
- Made Add/Edit/Deactivate faster by updating only the affected row where possible instead of always rewriting the whole sheet.
- If the page is showing old CSV fallback data, saving will copy the full displayed list into the private Sheet so migration is safer.
- Added visible source/warning messages on the Members page so admins can see whether data is coming from private Sheets or legacy CSV fallback.

## Recommended service-account env var

The easiest and safest setup is now:

```env
GOOGLE_SERVICE_ACCOUNT_JSON="{\"type\":\"service_account\",\"project_id\":\"YOUR_PROJECT\",\"private_key_id\":\"...\",\"private_key\":\"-----BEGIN PRIVATE KEY-----\\nYOUR_PRIVATE_KEY_HERE\\n-----END PRIVATE KEY-----\\n\",\"client_email\":\"success-portal-reader@YOUR_PROJECT.iam.gserviceaccount.com\"}"
GOOGLE_SHEETS_SPREADSHEET_ID="YOUR_MAIN_PRIVATE_SPREADSHEET_ID"
```

This avoids mismatching `GOOGLE_SERVICE_ACCOUNT_EMAIL` with a private key from a different service account.

Alternative setup still works:

```env
GOOGLE_SERVICE_ACCOUNT_EMAIL="success-portal-reader@YOUR_PROJECT.iam.gserviceaccount.com"
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYOUR_PRIVATE_KEY_HERE\n-----END PRIVATE KEY-----\n"
GOOGLE_SHEETS_SPREADSHEET_ID="YOUR_MAIN_PRIVATE_SPREADSHEET_ID"
```

## Required Google setup

1. Create a Google Cloud service account.
2. Enable the Google Sheets API in the same Google Cloud project.
3. Create/download a JSON key for the service account.
4. Add `GOOGLE_SERVICE_ACCOUNT_JSON` and `GOOGLE_SHEETS_SPREADSHEET_ID` to Vercel.
5. Share the relevant Google Sheet(s) with the service account email as **Editor**.
6. Deploy Vercel again.
7. Go to `/admin/members` and press **Check Sheets**.

## Private tab names

```env
CONTACTS_SHEET_NAME="contacts"
CURRICULUM_SHEET_NAME="curriculum"
TUTOR_CONFIG_SHEET_NAME="tutor_config"
FEEDBACK_LOG_SHEET_NAME="sentmsgs new"
PRINT_LOG_SHEET_NAME="print_log"
PRINT_SETTINGS_SHEET_NAME="print_settings"
```

If your tab names are capitalised differently, use the exact names from Google Sheets.

## Members sheet format

Recommended headers:

```csv
id,firstName,lastName,gender,parentName,parentEmail,years,active
```

Example:

```csv
mem_8f73k29x,Lily,Dasouqi,female,Laurise,parent@example.com,Year 6,TRUE
```

Notes:

- `id` is a permanent stable ID. Do not manually reuse it for another student.
- `gender` accepts `male`, `female`, `M`, or `F` on import.
- `parentName` is shown in the portal as Parent First Name for compatibility with the existing feedback system.
- `years` is the student’s school year.
- inactive students are hidden from tutor-facing Feedback/Print/Progress student search.

## Tutor sheet format

Recommended headers:

```csv
campusKey,tutorName,role,active,email,campusName
```

Example:

```csv
parramatta,Kevin,admin,TRUE,kevin@example.com,Parramatta
parramatta,Aayush,tutor,TRUE,,Parramatta
```

Roles:

- `admin`
- `tutor`

Only existing admins can access `/admin/tutors`.

## Safe rollout order

1. Keep the old public CSV env vars for now.
2. Add the service-account env vars.
3. Share the private Google Sheet with the service-account email.
4. Deploy this version.
5. Press **Check Sheets** on `/admin/members`.
6. Test Add/Edit/Deactivate/Reactivate on members.
7. Test Add/Edit/Deactivate/Reactivate on tutors.
8. Test Feedback, Progress, Print, Admin Dashboard, and Print Settings.
9. Only after everything works, unpublish sensitive public Google Sheet CSVs.

## Security notes

- Keep `GOOGLE_SERVICE_ACCOUNT_JSON` server-side only.
- Do not upload service account JSON keys to GitHub or public/shared folders.
- Mark sensitive env vars as Sensitive in Vercel.
- Rotate any token/password that appeared in screenshots or chat.
- API routes for contacts, curriculum, progress, print history, duplicate checks, print proxy, feedback sending, and print logging require login.
- Admin members/tutors APIs require admin access.
