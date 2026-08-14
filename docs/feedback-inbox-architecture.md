# Admin Feedback Inbox Architecture

## Purpose

The feedback inbox turns the existing Sent Feedback archive into an admin-only, Gmail-style conversation workspace. It is designed around the feedback relay already used by `st-feedback.site` and keeps each centre's data isolated in that centre's own deployment and Google Sheet.

This first version covers every feedback email created by the portal and every parent/centre reply captured by the relay. It does **not** yet import unrelated mail from the full Google Workspace mailbox. The data model and sidebar are structured so additional mail sources can be added later without replacing the feedback conversation system.

## Access control

- The page remains at `/sent-feedback`, but the navigation label is **Inbox**.
- The page and every inbox API call verify the signed session and the tutor's admin role through `requireAdmin()`.
- Non-admin tutors do not see the Inbox navigation item.
- Direct API requests from non-admin users receive `403 Admin access required`.

## Conversation sources

### Original feedback

Original portal sends are stored in the feedback log sheet. Each modern row contains:

- `conversationId`
- `relayToken`
- `messageId`
- campus, student and parent metadata
- sender alias and Reply-To address
- original subject and body

### Reply events

Reply events remain append-only in the `feedback_messages` sheet. Visible message event types are:

- `parent_reply` — parent to centre
- `centre_reply` — centre reply captured by the email relay
- `portal_reply` — admin reply sent from the website

State-only events are kept in the same append-only stream but hidden from the conversation body:

- `read_marker` — an admin opened/read the latest parent reply

This avoids destructive updates to Google Sheets and preserves an auditable timeline.

## Read and unread behaviour

A conversation is unread when it contains a `parent_reply` newer than the latest acknowledgement event.

Acknowledgement events are:

- `read_marker`
- `centre_reply`
- `portal_reply`

Therefore the unread badge clears when an admin either:

1. opens the conversation, or
2. replies to it from the centre inbox or portal.

A later parent reply makes the conversation unread again. The top navigation badge counts unread conversations, not total messages.

Read status is shared by all admins for the centre because it is stored in the centre's feedback message sheet rather than only in one browser.

## Portal replies

`POST /api/inbox-reply`:

1. verifies admin access;
2. verifies the conversation belongs to the logged-in centre;
3. sends through the existing Workspace `MAIL_USER` / `MAIL_PASS` Gmail transport;
4. uses the centre alias as the visible From address;
5. keeps the conversation relay address as Reply-To;
6. sets `In-Reply-To` and `References` to the original feedback message ID when available;
7. appends a `portal_reply` event to `feedback_messages`.

The From identity remains the professional centre identity (for example, `Green Valley Success Tutoring <greenvalley@st-feedback.site>`). The editable personal signature is part of the message body.

## Signature behaviour

The default signature is generated from the logged-in admin and campus:

```text
Faliha Rahim
Green Valley, Success Tutoring
```

Both the display name and signature can be edited before sending. The preferred values are saved per campus in browser local storage so an admin does not need to re-enter them for every reply. They are still editable for each individual email.

## UI structure

The page uses a Gmail-inspired layout:

- mailbox sidebar: Inbox, Unread, Replied, Failed and All feedback;
- searchable conversation list;
- bold unread conversations and numerical unread badges;
- full message thread on the right;
- inline reply composer;
- automatic refresh every 30 seconds;
- persistent unread badge in the main navigation.

The page does not automatically open the first conversation, preventing messages from being marked read merely because the inbox page loaded.

## New endpoints

- `GET /api/sent-feedback` — admin-only conversation list and derived state
- `GET /api/inbox-unread` — lightweight navigation badge count
- `POST /api/inbox-read` — append a persistent read marker
- `POST /api/inbox-reply` — send and log a reply from the portal

## Future extensions

The architecture can later support:

- full Workspace mailbox ingestion beyond portal feedback;
- attachments in portal replies;
- drafts and scheduled replies;
- assignment to a staff member;
- labels, stars and snoozing;
- per-admin read state rather than shared centre state;
- templates and AI-assisted reply drafting;
- delivery/open tracking where legally and operationally appropriate;
- a centre-configured signature stored server-side instead of browser-local preferences.
