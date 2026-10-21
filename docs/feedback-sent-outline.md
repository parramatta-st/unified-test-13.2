# Feedback sent outline

The My schedule student buttons now have a blue outline when successful feedback has been sent for that student on the displayed Sydney calendar day. A selected student keeps an orange outer ring. Every occurrence of the same student on that day shows the marker, and the student remains selectable for further feedback.

The marker updates only after the send succeeds, using the captured recipient rather than whichever student is currently selected. Undo, pending sends and failed sends do not mark students. Refresh restores markers from the existing feedback log, scoped to the authenticated campus. IDs distinguish students; older logs use the full student name and parent email rather than email alone so siblings are not marked together. An unavailable feedback log leaves the roster usable.

Validation completed 20 October 2026:

- `npm run typecheck`
- `npm test`: 94 tests and 12 print regression scenarios passed.
- `npm run build`
- `node scripts/qa_feedback_sent_browser.cjs`: Chromium checks at 320px, 390px and 1440px; success, failure, Undo, changed selection during pending send, repeat send, refresh and date isolation.
- Phone screenshot inspected; no horizontal overflow.

The browser check uses fictional data and intercepts all external APIs. It requires Playwright with Chromium installed, as in the existing CI workflow. `QA_CHROMIUM_PATH` can select an already installed Chromium executable.
