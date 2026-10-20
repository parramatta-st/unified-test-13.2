# Daily Rolls v0.5.0 verification

Prepared 13 October 2026. The matching portal implementation is on review PR #13; the extension's production-origin bridge needs that portal release.

| Executed extension suite | Passed |
| --- | ---: |
| Existing extraction, room, tutor and print regression checks | 44 |
| Schedule model and actual worker-handler checks with simulated storage | 22 |
| Actual review/controller code with simulated DOM and Chrome messaging | 12 |
| Portal bridge origin, actor/action, endpoint and failure checks | 5 |
| **Total** | **83** |

Checks cover stable-ID substitutions, retained history, filtered-view preservation, full-day removals, strict tutor-only whitelisting, old/concurrent collection safeguards, idempotency, sign-in/collection/storage failures, local backups after remote failures and retrying portal sync without another local revision. Network calls are confined to the named portal's same-origin schedule endpoint; no credentials or student records are included in captures.

In addition, the real Chromium extension verifier passed all **10 scenarios** in an isolated Vercel Sandbox, with fictional intercepted Hapana/portal pages. It exercised actual extension loading, collection, portal messaging, substitutions, filtered/full-day updates, history reopening, collection failure/recovery, downloads, responsive bounds and print previews. The fixture delays the first HTTPS navigation of extension-created tabs until Playwright can attach its routes. It does not use live Hapana credentials or real payroll data. Physical printing and the centre’s installed account layout still need the short operational check; this does not claim installation on the centre’s computer.

The matching portal commit `7b69f46de04acf7658ae557d1059c701eaa5cd15` passed **78 tests**, typecheck, Next production build and **46/46 browser journeys** across Chromium, Firefox and WebKit in GitHub Actions run `38346153261`. Its review PR #13 remains the source of the staged changes; production has not been updated. No live shift or schedule data was modified during these tests.

After release, sign in as an admin at the exact production portal host, update/reload the existing extension and refresh both tabs. Verify one real selected day's sync confirmation and a tutor/room print preview. The prior local backup remains available when sync cannot be confirmed.
