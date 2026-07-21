# Success Tutoring Portal v1.6.54 — Multi-site release hardening audit

This release is based on `v1.6.53-template-highlight-final`. It is a full-system audit pass ahead of rolling the portal out to all centres. Every source file was reviewed. No workflows changed for tutors or admins — the fixes below are security, correctness, and multi-site safety.

## Critical security fixes

### 1. Login sessions are now cryptographically signed (forgery fix)
Previously, being "logged in" meant having a plain `st_auth=1` cookie, and being an "admin" meant having a plain `st_tutor=<admin name>` cookie. Cookies are fully client-controlled, so **anyone who knew an admin's first name could forge full admin access — student names, parent emails, tutor management — without ever knowing the password.**

Now:
- Login issues an HMAC-SHA256 signed session token (`st_sess`) containing the tutor, campus, and a 30-day expiry.
- The middleware and every API route trust ONLY the verified token. The loose `st_tutor` / `st_campus` cookies are display-only.
- No new setup is required: the signing secret is derived from `TUTOR_PASSWORD` (or `SESSION_SECRET` if you set one). Existing users are simply asked to log in again once after deploying.

### 2. Login fails closed when TUTOR_PASSWORD is missing
Old behaviour: if `TUTOR_PASSWORD` was not set, **any password was accepted**. A new centre that deployed before finishing env setup was wide open. Login now returns a clear configuration error instead. Password comparison is also constant-time.

### 3. Open redirect after login fixed
`/login?next=https://evil.example` used to redirect a freshly signed-in tutor to any external site. The `next` target is now restricted to same-origin paths.

### 4. Admin role list no longer exposed publicly
`/api/tutors` (unauthenticated — the login page needs it for the dropdown) previously returned each tutor's `role`, handing attackers a list of exactly which names to target. Roles are no longer included; the login flow is unaffected because it takes the role from the login response.

### 5. Email header injection hardening
The feedback subject and recipient name are now stripped of CR/LF before being handed to the mailer.

### 6. Real student and parent details removed from the code
The Members import examples contained what appear to be real student names and a real parent Gmail address, shipped in the source to every centre. Replaced with clearly fake placeholders.

## Multi-site correctness fixes

### 7. Feedback email footer no longer hardcodes another centre
`defaultClosing()` had **"Success Tutoring Hornsby" and phone 0487 536 642 hardcoded** — every centre's parent emails would have carried Hornsby's number. The closing now uses `NEXT_PUBLIC_CAMPUS_NAME`, and the phone comes from the new optional `NEXT_PUBLIC_CONTACT_PHONE`. When no phone is configured, the email says "feel free to reply to this email" rather than showing a wrong number. The stray extra blank lines before "Kind regards," are also gone.

### 8. Remaining "Parramatta" fallbacks removed
Page footers, feedback/print log campus defaults, and the tutors CSV template now use the configured campus (`NEXT_PUBLIC_CAMPUS_NAME` / `NEXT_PUBLIC_CAMPUSES_JSON`) instead of hardcoded Parramatta values.

## Workflow bug fixes

### 9. Stale feedback message when switching lessons with the same Topic
Switching from one lesson to another that shares the same Topic kept the previous lesson's hand-typed message (the reset only watched the Topic text). The draft now resets on any lesson change. "Clear" also fully clears the selected student and template highlight.

### 10. Fresh parent email always wins
Sending feedback now prefers the live Members sheet email over the browser's cached "recent students" copy, so a parent email updated in Members can never be bypassed by a stale cache. Custom/non-member students behave as before.

### 11. Print quantity clamped to 1–50
The max was only an HTML attribute; typing or pasting `500` would genuinely queue 500 copies. Quantity is now clamped in code, and a cleared field falls back to 1.

### 12. Failed prints are finally logged
A print that failed between the portal and the Mac print server was never logged, so the admin "Failed print jobs" panel could not see it. Single-file and folder prints now log `ok: false` with the error, and a folder failure records exactly how many files printed and which file it stopped at (also shown to the tutor).

### 13. "Failed print jobs" no longer counts blank rows
Legacy log rows with an empty OK column were treated as failures. Only explicit failures count now; unknown rows show "—" in Recent prints.

### 14. Duplicate-feedback check honours the 90-day window
Rows with unparseable timestamps used to slip past the cutoff and trigger "possible duplicate" warnings forever.

### 15. Print sorter: "A Fun Worksheet" is not an Assessment
Any file starting with "A " was classified (and colour-ruled) as an Assessment. Now only "Assessment", a bare "A", or codes like "A 1" match. `A1`-style names and real assessments are unaffected.

### 16. Last-admin guard covers campus moves
Editing the last active admin of campus A onto campus B previously passed the guard (only B was checked) and left campus A with no admin.

### 17. Favicon no longer bounced to /login
The middleware allow-list only knew `favicon.ico`, but the site ships `favicon.svg`, so the icon request was redirected on the login page. All static assets (any path with a file extension) are now allowed through.

### 18. Unknown tokens stay visible
A typo like `{naem}` used to be silently deleted from the email. It is now left as-is so the tutor spots it in the preview.

## Handover

- `.env.local.example` (referenced by the v1.6.52 notes but missing from the zip) is restored, including the two new optional variables.

### New optional environment variables
| Variable | Purpose |
| --- | --- |
| `SESSION_SECRET` | Extra secret for signing sessions. Optional — defaults to a value derived from `TUTOR_PASSWORD`. |
| `NEXT_PUBLIC_CONTACT_PHONE` | Centre phone number for the feedback email footer. Optional — when unset, emails invite parents to reply instead. |

### Deploy notes
1. Ensure `TUTOR_PASSWORD` is set on every deployment **before** go-live (login now refuses to work without it).
2. Set `NEXT_PUBLIC_CONTACT_PHONE` per centre if you want a phone number in parent emails.
3. After deploying, everyone logs in once more (old unsigned cookies are no longer accepted). No other action needed.
