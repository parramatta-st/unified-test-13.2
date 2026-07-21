# Success Tutoring Portal v1.6.47 — Private Sheets Import + Admin UI fixes

## Main fixes

- Fixed Google Sheets CSV import saving error: `valueInputOption is required but not specified`.
- Added `valueInputOption=RAW` to Google Sheets `values.update` calls so imports, full overwrites, row updates, tutor saves, member saves, and print settings saves work correctly.
- Improved full-sheet overwrite safety: old leftover rows/columns are cleared only after the new values are successfully written.
- Improved Excel/CSV import handling for Members and Tutors:
  - Handles UTF-8 BOM headers from Excel.
  - Trims CSV headers.
  - Accepts common header variants like `First Name`, `Last Name`, `Parent Email`, `School Year`, `Tutor Name`, and `Campus Key`.
  - Generates a permanent `mem_` ID when a new imported student has a blank ID.
  - Keeps imported inactive records inactive when CSV uses `Active`, `status`, or similar columns.
- Fixed member/tutor import paths that could accidentally force imported rows to active.

## Members UI improvements

- Added polished admin summary cards.
- Added clearer private-sheet/source status.
- Added a visible save overlay while changes are being written.
- Added import instructions, CSV examples, template download, and preview rows.
- Improved table layout, action buttons, member avatars, and status pills.
- Added school-year suggestions while keeping the field flexible.

## Tutors UI improvements

- Added the same polished admin layout as Members.
- Added import instructions, CSV examples, template download, and preview rows.
- Improved tutor role/status display.
- Added save overlay while writing tutor updates.

## Testing completed

Commands run successfully:

```bash
npm install --package-lock=false --prefer-offline --no-audit --no-fund
npx tsc --noEmit
npm run lint
NEXT_TELEMETRY_DISABLED=1 npm run build
```

## Rollout note

Keep the old CSV fallback env vars temporarily until Members, Tutors, Feedback, Progress, Print logs, and Print Settings are tested against the private Google Sheet.
