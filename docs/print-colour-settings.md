# Print Colour Settings

This version adds an admin-only Print Colour Settings page at `/settings`.

Version 1.6.43 also fixes the K-10 path detection issue where Mac catalog paths beginning with `Content/Year 3/...` could make Revision and Homework files show as Colour. The portal now strips the hidden `Content` wrapper and applies the visible folder path, so `Year 3 / English / BOL / R1` correctly resolves to the Revision rule.

Admins can open it from the Admin Dashboard using the **Print Colour Settings** button.

## Default rules

| Area | Material | Default print mode |
| --- | --- | --- |
| Kindy-Year 10 | Lessons | Colour |
| Kindy-Year 10 | Revisions | Black & White |
| Kindy-Year 10 | Homework | Black & White |
| Kindy-Year 10 | Other / Assessment | Colour |
| Other programs | Default | Colour |

The portal applies the rule to every file before sending it to the Mac print service. This means a single **Print Folder** action can print mixed modes, for example:

- L1 in Colour
- R1 in Black & White
- H1 in Black & White

## Google Sheet format

Create a tab such as `print_settings` with these headers:

```tsv
campusKey	scope	materialType	printMode	settingKey	updatedBy	updatedAt
parramatta	k10	lesson	colour	k10Lesson	Kevin	2026-06-03T00:00:00.000Z
parramatta	k10	revision	bw	k10Revision	Kevin	2026-06-03T00:00:00.000Z
parramatta	k10	homework	bw	k10Homework	Kevin	2026-06-03T00:00:00.000Z
parramatta	k10	other	colour	k10Other	Kevin	2026-06-03T00:00:00.000Z
parramatta	nonstandard	default	colour	nonstandardDefault	Kevin	2026-06-03T00:00:00.000Z
```

Supported `printMode` values include:

- `colour`
- `color`
- `bw`
- `black and white`
- `monochrome`
- `grayscale`
- `greyscale`

The portal normalises these to `colour` or `bw`.

## Environment variables

Add these to Vercel and local `.env.local`:

```env
PRINT_SETTINGS_CSV_URL="https://docs.google.com/spreadsheets/d/e/YOUR_SHEET/pub?gid=PRINT_SETTINGS_GID&single=true&output=csv"
PRINT_SETTINGS_WEBHOOK_URL="https://script.google.com/macros/s/YOUR_PRINT_SETTINGS_WEBHOOK/exec"
```

The CSV URL is for reading the current settings. The webhook URL is for saving settings from the admin page.

## Apps Script save endpoint

Use `docs/print-settings-apps-script.js` as the Apps Script for the settings webhook.

The script expects one sheet/tab named `print_settings`. It rewrites the five rows for the selected `campusKey` whenever an admin saves settings. It also includes a `myFunction()` manual test helper for the Apps Script editor; the deployed web app still uses `doPost(e)`.

## Fallback behaviour

If `PRINT_SETTINGS_CSV_URL` is missing or temporarily unavailable, the portal uses the recommended defaults.

If `PRINT_SETTINGS_WEBHOOK_URL` is missing, the Settings page still displays the rules, but the Save button is disabled.

## Mac print service requirement

The portal sends colour data to `/api/print-proxy?action=print`, but the Mac print service must also support those fields. Replace the Mac print service `server.js` with the colour-mode version included in `tutoring-print-service-colour-mode.zip`.

No database re-index is needed for colour settings unless the content files themselves have changed.
