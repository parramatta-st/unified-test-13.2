# Door NFC / QR Time Clock

## Agreed workflow

This is the centre's deliberately low-friction, trusted-tutor attendance flow:
no portal login, no PIN, and no location prompt. A normal NFC website-link tag
or a QR code opens `/clock/tap#key=<random-access-key>`. The first visit selects
an active tutor. This phone remembers that tutor; later visits show the greeting,
current saved state, and one Clock In or Clock Out button. Change tutor is always
available except while an action is saving or awaiting confirmation.

Clock In shows a saved confirmation with the server time, then redirects to the
same site's `/login` after four seconds. Continue to portal login is available
immediately. Clock Out stays on its confirmation screen with a login link.
Opening the tag never records an action automatically.

The door link is not physical-presence proof. A copied link works away from the
centre and anyone with it can select a name. This is the explicitly accepted
trust model, supported by the centre's fortnightly roster/hour reconciliation.

## Activation after deploying the tested feature

1. Back up the existing Time Clock spreadsheet first, especially the event ledger.
2. Sign into the normal portal as an administrator.
3. Open **Admin > Door NFC / QR > Create door link**.
4. Copy and privately retain the entire URL, including `#key=` and its value.
   The URL is shown only when created. The server stores a hash, not the raw key.
5. Write the URL to a standard NFC tag as a website/URI record. No Web NFC API,
   special tutor app, location permission or individual PIN is required.
6. Save the locally generated QR image and place it beside the NFC sticker as
   the alternate entry method. No third-party QR site receives the link.
7. Complete the physical-phone checklist below before staff use it.

**No new Vercel secret is needed.** The existing Time Clock service account and
spreadsheet are reused. `door_clock_links` is created only when an admin enables
or changes the link. Status reads do not create this tab. The optional
`DOOR_CLOCK_LINKS_SHEET_NAME` can rename that owned settings tab.

**Vercel previews default to read-only for door writes.** A preview can share live
Sheets with an older production build that cannot read v2 events. Never enable a
preview on a live payroll sheet. For explicit staging, set
`DOOR_CLOCK_ALLOW_PREVIEW_WRITES=true` and a separate `TIME_CLOCK_SPREADSHEET_ID`
different from the primary sheet, containing only designated test data. This
opt-in is not needed in Production.

Each centre must create its own link on its own portal. Creating a Parramatta
link does not enable the other centre deployments. Do not publish the real link,
QR image, key, or credentials in this public repository or its issue/PR comments.

## Disable or replace

Admin > Door NFC / QR can disable or replace the current link. Replacement makes
the old tag and QR invalid; update both. Refresh an already-open old door page
and it will be refused at the next API request. A request already accepted by the
server before a replacement is not retroactively undone. Normal portal Time
Clock continues to work when the door link is disabled.

The settings history is append-only. The most recently appended entry for a
campus is authoritative. A malformed latest entry fails closed rather than
reviving an old key. Make configuration changes from one admin window at a time.
If a configuration request loses its response, refresh settings before trying
again. A newly created key cannot be recovered from its hash; replace it if lost.

## Storage and auditing

`door_clock_links` stores:
`eventId, campusKey, linkId, enabled, tokenHash, label, createdAt, createdBy`.
The high-entropy key stays in the URL fragment (not the HTTP URL) and then in
browser session storage; the page sends it in `x-st-door-key`. It is not logged,
sent to a QR web service, placed in a portal session cookie, or saved in the
Time Clock ledger. The remembered tutor is a campus/id preference in localStorage,
not authentication. Existing portal identity preferences are not overwritten.

Door clock events reuse the authoritative `time_clock_events` ledger. They keep
server timestamps, request-ID replay protection, overlap checks, version checks,
range clipping, existing payroll totals and admin correction/void history.
The action is explicit, never an unsafe toggle. A stale Clock Out page cannot
end a later shift that has replaced the one it displayed.

New events have:
- `accessMethod=door_link`
- `accessPoint=<nonsecret door-link ID>`
- `identityMethod=name_selection`
- `actorRole=tutor`, including when an admin selects their own name
- `locationVerified=FALSE` and `adminOverride=FALSE`

The materialised shifts append clock-in/out method and access-point columns.
Payroll's location audit says **Door NFC / QR link - location not required (name
selected)**. Intentional door access is not falsely flagged as missing GPS;
long, overnight, overlapping, incomplete and Sunday shifts retain their existing
review rules. NFC, QR and a copied link cannot be distinguished and are therefore
labelled as the same door-link method.

## Ledger compatibility and rollback

Historical schema-v1 hashes use the original header list, byte-for-byte. Ordinary
portal events remain v1; only door events use schema v2, whose hash includes the
new audit fields. The existing original tests and additional hash/tamper tests
must pass before deployment.

**Once schema-v2 door events exist, do not roll back to an old v1-only ledger
reader.** An old build would reject v2 records and could regenerate incomplete
payroll views. To turn this feature off safely, disable the door link while
retaining the v2-compatible reader. If an application rollback is necessary,
backport that reader to the rollback build first. Never delete real ledger rows
to make an older release appear compatible.

## Failure behaviour

A failed status read disables clocking until a successful refresh; it does not
pretend the tutor is clocked out. A failed or slow save is not shown as success.
The browser retains the exact unresolved request ID in session storage and shows
**Check clock-in result** or **Check clock-out result**. The same request is used
when retrying or reloading, so an already-committed event is replayed rather than
creating another shift. Writes are not automatically repeated on page opening.

If storage is blocked, the page still works during the current visit but cannot
remember the tutor or preserve an unresolved request through reload. In that
case check the saved status or ask the manager rather than guessing. Do not rely
on offline clocking; there must be a server-confirmed save.

The existing Sheets ledger is not a transactional database. Multi-instance
concurrency and real Sheets quota behaviour remain integration considerations.
The new burst guard is per server instance, not a distributed rate limiter.

## Test commands and scope

`npm test` runs the original 45 tests and door API/storage/hash/client-state tests
using synthetic identities and a simulated Google Sheets transport.
`npm run typecheck` checks TypeScript. `npm run build` builds the application.
The existing lint script explicitly skips lint; do not report that as a clean
lint scan.

`scripts/verify-door-browser.cjs` launches the real compiled Next pages locally
and tests Chromium, Firefox and WebKit against mocked attendance APIs. It checks
selection/remembering, no GPS requests or new portal session, confirmation and
real login navigation, retries across reload, revoked keys, failed status reads,
removed tutors, long names, small screens, admin QR creation, and middleware.
GitHub Actions installs the pinned test-only Playwright runtime separately; it
is not a production dependency. Screenshots and results are uploaded as the
`door-clock-evidence` artifact. These are synthetic browser journeys, not physical
NFC tests or live Google Sheets writes.

## Real-phone checklist

Use designated test staff/data rather than impersonating an actual tutor's shift.
Test iPhone/Safari and Android/Chrome, including a phone that has never signed in.
Tap the actual door tag and scan the printed QR. Confirm that all of the link is
read, no GPS/password prompt appears, a fresh phone can select a name, and a
returning phone remembers it. Some phones require a notification tap to open the
URL; physical behaviour must be checked on the phones actually used.

Clock In, inspect the confirmation, and verify the automatic `/login` redirect.
Tap again, confirm Clock Out is offered, and complete it. Check the original
ledger, payroll totals and the labelled access method. Verify normal portal GPS
clocking still works and that the door key does not unlock any portal data API.
Test an interrupted connection, a replaced tag, and a deactivated tutor.
Void synthetic test shifts through the normal admin UI so the audit trail remains.
