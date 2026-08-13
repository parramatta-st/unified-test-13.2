# Feedback Inbox Preview Acceptance Checklist

This checklist is used to validate the admin-only feedback inbox before merging it to `main`.

- Confirm the preview is built from `feature/admin-feedback-inbox-v1`.
- Confirm an admin can open Inbox and a non-admin cannot.
- Confirm the unread conversation count appears in the top navigation.
- Confirm opening an unread conversation records it as read.
- Confirm a new parent reply makes the conversation unread again.
- Confirm replies can be sent from the website using the centre Workspace alias.
- Confirm the editable admin name/signature is included only when requested.
- Confirm the portal reply appears in the same conversation and clears the unread state.
- Confirm Green Valley data remains scoped to Green Valley.

This file also creates a fresh preview deployment after the earlier Vercel build-rate-limit window.
