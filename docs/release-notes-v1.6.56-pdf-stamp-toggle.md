# Portal v1.6.56 — PDF student-name runtime switch

## What changed

The Print page now reads the student-name stamping state from the connected Mac
print service and allows tutors to turn it on or off when the Mac service reports
runtime-setting support.

The setting is changed through:

- Portal proxy action: `/api/print-proxy?action=stamp-settings`
- Mac endpoint: `/api/pdf-stamp-settings`

The switch reflects the real Mac-side value, displays a saving state, and reports
clear errors when the Mac is disconnected or an older service is still running.

## Requirements

Install and restart Mac print service v1.6.56. Older v1.6.55 services can stamp
PDFs but cannot change the setting at runtime, so the portal switch remains
read-only until the Mac update is installed.

Diagnostic tests remain unstamped regardless of the switch. A selected student
is still required for every print job for logging and accountability.
