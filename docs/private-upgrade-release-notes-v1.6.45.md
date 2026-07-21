# Success Tutoring Portal v1.6.45 — Private Sheets + Admin Members/Tutors

## Main changes

- Added private Google Sheets service-account support.
- Added `/admin/members` for student member management.
- Added `/admin/tutors` for tutor/admin management.
- Added CSV import/export for members and tutors, with required format shown in the portal.
- Moved the StudentPicker to `/api/contacts` so contacts are not loaded directly from a public CSV in the browser.
- Moved feedback curriculum loading to `/api/curriculum` so curriculum can also be private.
- Progress, duplicate feedback checks, duplicate print checks, student print history, and admin dashboard now read from private Sheets first.
- Feedback logs, print logs, and print settings can now write directly to private Sheets when the service account is configured.
- Legacy public CSV/webhook fallbacks remain for a safe transition.
- Added login checks to sensitive API routes.
- Added basic security headers.
- Upgraded Next.js from 14.2.4 to 14.2.35.

## New admin pages

```text
/admin/members
/admin/tutors
```

Members fields:

```text
id, firstName, lastName, gender, parentName, parentEmail, years, active
```

Tutors fields:

```text
campusKey, tutorName, role, active, email, campusName
```

## Testing completed

Commands run successfully:

```bash
npm install --package-lock=false
npx tsc --noEmit
npm run lint
NEXT_TELEMETRY_DISABLED=1 npm run build
```

Production build passed with Next.js 14.2.35.

## Important rollout note

Do not immediately unpublish the old public Google Sheet CSV links until the private service-account version is tested on Vercel. Once confirmed, unpublish the sensitive sheets.
