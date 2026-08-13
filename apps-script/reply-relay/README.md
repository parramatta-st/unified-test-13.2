# Success Tutoring reply relay

This Apps Script runs in the Google Workspace account that owns the `@st-feedback.site` aliases. A dedicated Vercel deployment at `https://relay.st-feedback.site` acts as a stateless hub and routes each reply to the correct centre deployment.

## Safety

The Vercel feature flag `REPLY_RELAY_ENABLED` defaults to off. Do not enable it for a centre until:

1. the Workspace catch-all/routing rule for `reply+...@st-feedback.site` is delivering into the main Workspace mailbox;
2. this Apps Script has been installed and authorised;
3. `REPLY_RELAY_SECRET` is configured on the relay hub and participating centre deployments, and the same value is stored as `WEBHOOK_SECRET` in Apps Script;
4. `REPLY_RELAY_HUB_ROUTES` is configured on the central relay project;
5. a test conversation has completed end-to-end for the pilot centre.

## Architecture

New relay tokens are shaped like:

`<campus-route>-<32-hex-random-chars>`

For example, a Green Valley conversation may use:

`greenvalley-0123456789abcdef0123456789abcdef`

The Workspace routing regex already accepts this format. The central relay reads the campus prefix and proxies the lookup/webhook to that centre's Vercel deployment. Conversation data stays in the centre's own feedback sheets, so the hub does not need Google Sheets credentials and one Apps Script can serve every centre.

## Apps Script properties

Open Apps Script > Project Settings > Script Properties and add:

- `WEBHOOK_BASE_URL` — `https://relay.st-feedback.site`
- `WEBHOOK_SECRET` — the same long random secret as Vercel `REPLY_RELAY_SECRET`
- `RELAY_DOMAIN` — `st-feedback.site`
- `LOOKBACK_DAYS` — optional, default `7`
- `MAX_THREADS` — optional, default `100`

## Install

1. Create a standalone Apps Script project while signed in as the Workspace user behind `parramatta@st-feedback.site`.
2. Paste `Code.gs` into the project.
3. Add the Script Properties above.
4. Run `testRelayConfiguration` once and approve the Gmail/UrlFetch permissions.
5. Confirm the execution log lists the required campus aliases in `gmailAliases`.
6. Run `installMinuteTrigger` once. It replaces any existing trigger for `runReplyRelay` and creates a one-minute trigger.

## Central relay Vercel variables

On the `st-feedback-relay` project configure:

- `REPLY_RELAY_SECRET` — same secret as Apps Script `WEBHOOK_SECRET`
- `REPLY_RELAY_HUB_ROUTES` — JSON mapping route prefixes to centre sites. Multiple aliases can point to the same site if desired. Example:

```json
{
  "greenvalley": "https://stgv-unified-site.vercel.app",
  "stgv": "https://stgv-unified-site.vercel.app",
  "parramatta": "https://unified-test-13-2.vercel.app",
  "stp": "https://unified-test-13-2.vercel.app",
  "mtgravatteast": "https://stmg-unified-site.vercel.app",
  "stmg": "https://stmg-unified-site.vercel.app"
}
```

The hub is stateless: it does not need the centres' Google Sheets environment variables.

## Centre Vercel variables

For each centre participating in the relay configure:

- `REPLY_RELAY_SECRET` — same shared secret used by the hub and Apps Script
- `REPLY_RELAY_DOMAIN=st-feedback.site`
- keep `REPLY_TO` set to the centre's real monitored inbox; the relay uses this as the forwarding destination
- leave `REPLY_RELAY_ENABLED` unset/false until that centre is ready to go live

When `REPLY_RELAY_ENABLED=true`, new feedback emails use a unique reply address such as `reply+<campus-route>-<secure-random>@st-feedback.site`. The relay forwards parent replies to the centre's real inbox. Staff replies from that centre inbox are sent back through the unique relay address, logged in that centre's portal, and relayed to the parent's original Gmail thread as the correct campus alias.
