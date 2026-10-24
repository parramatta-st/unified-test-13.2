# Daily Rolls 0.6.4 — handle late cancellations correctly

This release connects verified Hapana student bookings to `parramatta-st/unified-test-13.2`. Install the matching portal change before collecting. Open START-HERE.html for the numbered setup guide.

## Late cancellations

Hapana retains late-cancelled clients in its visible booked list but excludes them from Total Booked. The reader now uses the live checkbox in the labelled Late Cancel column to exclude those clients from printed rolls and Feedback schedules. Two active bookings plus one visible late cancellation now verify as two bookings. RSVP, attendance, pending payment, row order and grey styling do not decide whether a booking is included. Missing or unexplained extra active bookings still block collection. Conflicting cancellation states for a duplicated client require another read.

## Portal reconnection

Daily Rolls now reconnects its bridge in an already-open portal tab after an extension reload, without refreshing the page or losing a draft. Both the custom portal address and the supported original Vercel alias are checked. If the first tab is unreachable, another portal tab can be used. The scripting permission is used only to restore the packaged bridge on the explicitly allowed portal hosts. Server rejections do not trigger repeated writes.

If the initial portal connection failed, or a collection expired, **Reconnect and recollect** starts a fresh verified collection after admin sign-in. Temporary upload failures still use **Retry student sync** on the same capture, preserving duplicate and stale-collection protection. The Student bookings panel remains the confirmation for Feedback; printing or local tutor backup success alone does not mean bookings synced.

## Combined classes

Overlapping classes taught by the same tutor now share one room. Room suggestions consider their combined booking count. Changing a room by dropdown or drag/drop moves the linked classes together, including recognised `(sub)` / `(substitute)` labels. Adjacent, non-overlapping hours can still use different rooms. Each class and every booking stays in its own labelled print section. A class retry keeps an existing room and attaches recovered classes for the same tutor.

## Update and use

1. Unzip the download. Copy **all files inside hapana-rolls** into the permanent folder used by the existing Chrome extension. Replace matching files and include the new scripts. Keep the existing extension installation so tutor-only backups survive.
2. Open `chrome://extensions`, click Reload on Daily Rolls and confirm version **0.6.4**. Close old review tabs and refresh both Hapana and the portal.
3. Sign in **as an admin** at https://unified-site.successtutoringparramatta.com/admin/feedback-schedule in the same Chrome profile.
4. In Hapana, select Schedule → Day and the required date. Clear filters. To replace the entire included day, tick **All classes for this day are visible** before collecting; otherwise unseen classes are retained.
5. Collect the day and wait for **Student bookings synced to Feedback** in the new Student bookings panel. Local tutor backup success is a separate confirmation.
6. Open **Link tutors and students**. Choose the saved date. Link full instructor names to portal accounts, for example **Sai Arulanathan → Sai**. Unique tutor first names and exact student/parent matches link automatically. Ambiguous or similar names require review. If the Hapana booking shows a parent, check the actual child. Manual student links are remembered; use a dated-class exception when siblings share a parent record. Use parent name, year and Member ID to check the child.
7. Refresh the tutor's Feedback page. A linked tutor with a booking today in Sydney sees My schedule / All students beside Parent Feedback. Other tutors retain the normal student search. The selected student and draft survive switching views.

No terminal, API keys or manual spreadsheet creation are needed when the portal's existing private Google Sheets connection is working. The portal creates its own `feedback_roll_events` tab on the first successful real import. If private Sheets is not configured, the extension reports that clearly and local rolls remain usable.

## What is sent

Student sync sends verified Hapana student IDs and names, instructor labels, class IDs/titles and times. It excludes phone numbers, payments, room choices and parent contact details. The portal uses its own linked Members for parent email, name, school year and gender. Student bookings are stored privately on the portal; the extension keeps them only in the current review tab's memory. Existing local tutor-only revision backups/exports still have no student data. Closing the review tab requires collecting again to retry student sync.

An admin-only signed cookie authorizes every upload and identity link. A two-hour signed collection ticket is requested before reading classes. Tickets are tied to the admin, campus, date and capture ID. They and portal credentials are not saved in exports. Duplicate retries do not add another capture, older collections cannot replace newer substitutions, and incomplete/altered captures are ignored. Do not remove/reinstall the extension just to update it.

## Retained behaviour and limits

Collection remains read-only in Hapana. Room/tutor previews, print fitting, phones/payment columns and tutor-only local history remain available. Student sync does not alter shifts, payroll, bookings or attendance. The older tutor-only Time Clock upload retains its separate endpoint and release dependency (PR #13); this Feedback feature does not require merging that payroll change. A tutor-only sync failure does not prevent the new student sync or printing.

Snapshots need recollection after additions, cancellations or substitutions. Assessments/diagnostics and one-to-one sessions are still excluded. An empty/filtered day cannot erase a previous saved day, because the collector cannot verify that no classes exist. Collect a non-empty verified day to sync; administrative empty-day clearing is not provided here. Collection tickets expire after two hours; sign in and recollect when requested. Full-day replacement applies only when the whole visible group-class day was confirmed before collection.

See the portal's `docs/daily-rolls-feedback-sync.md` for storage and verification details. All included tests use fictional data. A first on-site collection still needs checking against Hapana and the correct parent recipient before sending feedback.
