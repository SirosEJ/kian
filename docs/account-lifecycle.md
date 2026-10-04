# Kian account lifecycle, deletion and retention

Decisions for SFT-226. These must be reviewed by the product owner and reflected in the published privacy policy and terms before public launch.

## Sign-up and ownership

Users create an account with email and password (Firebase Authentication) and land on a dashboard that explains how to connect services. A `users` row is created on first authenticated write. Every table holding customer data carries `owner_id`, and every query and mutation filters on the verified token's UID; foreign identifiers return 404 (or 403 for OAuth state bound to another user). Isolation is covered by `apps/api/tests/e2e/isolation.spec.ts`.

## Self-service account deletion (implemented)

Settings → Account → Delete my account requires typing `DELETE`. `DELETE /account` (confirmation in body) then:

1. Deletes the `users` row; foreign keys cascade to connections (encrypted tokens), OAuth states, instructions, conversations and messages, tasks, trust rules, activity and executions.
2. Deletes the Firebase user, ending sign-in. If this step fails the API returns 502; the user retries, which is safe because the data deletion is idempotent.

Not undone: objects already created in Google Calendar, Jira or sent email. Provider-side application grants are not revoked automatically; the UI and privacy policy tell users they can remove Kian in their provider account.

## Retention

| Data | Retention |
|---|---|
| Instructions, conversations (the user's messages and Kian's replies), proposals, trust rules, execution receipts, activity | Until the user deletes the account (owner decision, SFT-253). "New conversation" starts a fresh thread; older threads are kept, not deleted |
| Jira data Kian reads to answer a question (SFT-274) | Read live with the user's own Jira connection when they ask; not copied into Kian's database. The answer text and the result table stay in the conversation (kept until account deletion). The issues Kian read (key, title, status, assignee, dates, and for one issue its description and last comments) are sent to the planning model provider to write the answer, capped at 40 rows per lookup and about 14,000 characters. Activity records only that a lookup happened and how many issues were read. Confirm the provider's retention terms |
| What Kian remembers (SFT-280) | Per user, in Kian's database: names of people (from Jira assignees and reporters, calendar attendees the user asked about, and addresses the user emailed after approving), project keys, epic titles, calendar names, and nicknames or spoken-form corrections the user gave in chat. Never email bodies, event descriptions or secrets; at most 500 entries (least used and oldest dropped first, the user's own kept longest). Visible, editable and deletable in Settings, with a switch that stops both learning and use. Deleted with the account. The entries that match a message (up to 12) are sent to the planning model provider with that message, as hints. Activity records only how many entries were learned. The AI model itself is not retrained. |
| Kian's own photos (SFT-327) | Eight photos supplied by the product owner (their child and themselves) ship with the API in `apps/api/assets/persona/`, re-encoded with all metadata (including any location) removed. They are not part of the public web files: they are served only to signed-in users, through `GET /persona/photos/:id`, when a user asks Kian who he is or to see his photo. Every signed-in user can see them. Remove them by deleting that folder. The conversation stores only the photo ids, not the images. |
| Calendar events Kian deletes (SFT-279) | Only after the user approves a card that shows the event's title, time and calendar. The event id is kept in the task (and, hidden, with the table in the conversation) until the account is deleted; Kian cannot undo a delete. Deleting is never auto-trusted. |
| Calendar data Kian reads to answer a question (SFT-277) | Read live with the user's own Google Calendar connection when they ask, with read-only GET requests; not copied into Kian's database. The answer text and the result table stay in the conversation (kept until account deletion). Event titles, times, locations, the user's own answer and the number of invitees are sent to the planning model provider to write the answer, capped at 40 rows per lookup. Descriptions and invitee names or emails are read only when the user asks about one named event. Activity records only that a lookup happened and how many events were read. Confirm the provider's retention terms |
| What the planning model receives | The last 20 messages of the current conversation, the user's undecided proposals, and connection names and types (never credentials or other users' data), sent to the model provider for each message; confirm the provider's retention terms |
| Connection secrets | Until disconnect (cleared immediately) or account deletion |
| Raw audio | Not stored by Kian. With live dictation the browser's own speech-recognition service hears the audio (in Chrome, audio is sent to Google; Safari uses Apple); where that is unavailable Kian sends the recording to its transcription provider. Confirm both retention settings and disclose them in the privacy policy SFT-281: when audio is sent for server transcription, a short vocabulary prompt (Kian, Jira, Sepenta and up to about 600 characters of the user's remembered names, project keys and epic titles, never addresses) is sent with it so names are recognised. Spoken-form corrections the user makes by editing dictated text before sending are stored (word pairs only, in What Kian remembers) after the same change is seen in two separate messages; a counter of such changes is kept per user until the user deletes what Kian remembers or the account. Nothing is learned or sent while learning is off. |
| Operational logs | No request bodies or decrypted secrets; retained per hosting log policy (proposed 30 days) |
| Database backups | Deleted data expires from backups within the backup retention window (proposed 30 days, to be confirmed) |

## Open decisions for the product owner

- Confirm the 30-day backup and log windows.
- Decide whether to add automatic pruning of old instruction text and activity (not implemented; currently kept until deletion).
- Decide whether to require email verification before connecting services.
- Publish privacy policy and terms; confirm transcription and planning provider retention terms.
