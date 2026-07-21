# Success Tutoring Portal v1.6.46 — Private Sheets Fixes

## Main fixes

- Fixed older member gender values (`M`/`F`) so editing old contacts no longer triggers “Gender must be male or female”.
- Added support for `GOOGLE_SERVICE_ACCOUNT_JSON` to reduce service-account setup mistakes.
- Added clearer errors for service-account problems such as `Invalid grant: account not found`.
- Added admin-only `/api/admin-sheets-status`.
- Added **Check Sheets** buttons on Members and Tutors pages.
- Members page now shows whether it is using private Google Sheets or legacy CSV fallback.
- Saving from a legacy CSV fallback now bootstraps/copies the displayed members into the private Sheet.
- Add/Edit/Deactivate member actions now update the affected row where possible instead of always reloading and rewriting the full list.
- Member and tutor pages update local state after saving instead of forcing an extra full refresh.
- Updated `.env.local.example` to recommend `GOOGLE_SERVICE_ACCOUNT_JSON`.

## Files changed

```text
.env.local.example
lib/googleSheets.ts
lib/members.ts
pages/api/admin-members.ts
pages/api/admin-sheets-status.ts
pages/api/admin-tutors.ts
pages/admin/members.tsx
pages/admin/tutors.tsx
package.json
docs/private-sheets-admin-members.md
docs/private-upgrade-release-notes-v1.6.46.md
```

## Testing completed

```bash
npm install --package-lock=false --prefer-offline --no-audit --no-fund
npx tsc --noEmit
npm run lint
NEXT_TELEMETRY_DISABLED=1 npm run build
```

Production build passed with Next.js 14.2.35.

## Rollout note

Keep the legacy public CSV env vars during testing. After private Sheets is confirmed working, unpublish/remove the public contacts, feedback log, print log, tutor config, and print settings CSVs.
