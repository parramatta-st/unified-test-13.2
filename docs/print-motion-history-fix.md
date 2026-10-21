# Printing history flicker and centre-to-dock motion

The screen recording showed the Last sent to printer panel alternating between a receipt and Loading print history as each file completed. The component cleared its receipts before every refresh. This repeatedly changed the panel height and moved the print controls underneath it. Rapid events could also abort a history read before it completed.

The history component now keeps its last successful result visible during background reads and after a temporary failure. It coalesces refreshes while a read is in flight into one follow-up read. Changing the student still remounts the student-specific history. Batch progress stays present at completion instead of disappearing and shrinking the panel.

Printing now uses one persistent activity panel. Its first appearance pauses briefly at the viewport centre, then moves into the responsive bottom dock with a transform animation and a fading background shade. Additional jobs join the dock without replaying the entrance or collapsing an expanded list. The completed progress indicator remains visible until the existing success dismissal, avoiding a panel-height jump. Reduced-motion preferences skip the entrance. Resizing the viewport settles the panel into its responsive dock.

No printer request, queue ordering, duplicate guard, retry policy or receipt-storage API has changed.

Validation:

- TypeScript check and production build passed.
- All 94 tests and 12 print queue/history/API regression scenarios passed.
- Existing Chromium browser flows passed at 1440px, 390px and 320px: queued jobs, navigation during printing, history switching/retry, partial failure, no automatic resubmission, reload recovery and dismissal.
- New browser checks exercise the actual animation at fixed timeline positions, multi-file history height, retained history during errors, coalesced refresh bursts, additional jobs joining the same dock, and reduced motion.
- Phone and desktop screenshots inspected.

The existing CI still runs its WebKit checks. The local animation verification used Chromium; a physical iPhone check has not been performed.
