# Success Tutoring reply relay

This Apps Script runs in the Google Workspace account that owns the `@st-feedback.site` aliases.

## Safety

The Vercel feature flag `REPLY_RELAY_ENABLED` defaults to off. Do not enable it until:

1. the Workspace catch-all/routing rule for `reply+...@st-feedback.site` is delivering into the main Workspace mailbox;
2. this Apps Script has been installed and authorised;
3. `REPLY_RELAY_SECRET` is configured in Vercel and the same value is stored as `WEBHOOK_SECRET` in Apps Script;
4. a test conversation has completed end-to-end.

## Apps Script properties

Open Apps Script > Project Settings > Script Properties and add:

- `WEBHOOK_BASE_URL` — the Vercel site whose relay API should receive events, e.g. `https://stgv-unified-site.vercel.app`
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

## Vercel variables

For the pilot campus configure:

- `REPLY_RELAY_SECRET` — same secret as Apps Script `WEBHOOK_SECRET`
- `REPLY_RELAY_DOMAIN=st-feedback.site`
- keep `REPLY_TO` set to the centre's real monitored inbox, e.g. `greenvalley@successtutoring.com.au`; the relay uses this as the forwarding destination
- leave `REPLY_RELAY_ENABLED` unset/false until routing and the script are verified

When `REPLY_RELAY_ENABLED=true`, new feedback emails use a unique reply address such as `reply+<secure-token>@st-feedback.site`. The relay forwards parent replies to the real centre inbox. Staff replies from that centre inbox are sent back through the unique reply address, logged in the portal, and relayed to the parent's original Gmail thread as the correct campus alias.
