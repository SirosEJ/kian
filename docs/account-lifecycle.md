# Kian account lifecycle, deletion and retention

Decisions for SFT-226. These must be reviewed by the product owner and reflected in the published privacy policy and terms before public launch.

## Sign-up and ownership

Users create an account with email and password (Firebase Authentication) and land on a dashboard that explains how to connect services. A `users` row is created on first authenticated write. Every table holding customer data carries `owner_id`, and every query and mutation filters on the verified token's UID; foreign identifiers return 404 (or 403 for OAuth state bound to another user). Isolation is covered by `apps/api/tests/e2e/isolation.spec.ts`.

## Self-service account deletion (implemented)

Settings → Account → Delete my account requires typing `DELETE`. `DELETE /account` (confirmation in body) then:

1. Deletes the `users` row; foreign keys cascade to connections (encrypted tokens), OAuth states, instructions, tasks, trust rules, activity and executions.
2. Deletes the Firebase user, ending sign-in. If this step fails the API returns 502; the user retries, which is safe because the data deletion is idempotent.

Not undone: objects already created in Google Calendar, Jira or sent email. Provider-side application grants are not revoked automatically; the UI and privacy policy tell users they can remove Kian in their provider account.

## Retention

| Data | Retention |
|---|---|
| Instructions, proposals, trust rules, execution receipts, activity | Until the user deletes the account |
| Connection secrets | Until disconnect (cleared immediately) or account deletion |
| Raw audio | Not stored by Kian. With live dictation the browser's own speech-recognition service hears the audio (in Chrome, audio is sent to Google; Safari uses Apple); where that is unavailable Kian sends the recording to its transcription provider. Confirm both retention settings and disclose them in the privacy policy |
| Operational logs | No request bodies or decrypted secrets; retained per hosting log policy (proposed 30 days) |
| Database backups | Deleted data expires from backups within the backup retention window (proposed 30 days, to be confirmed) |

## Open decisions for the product owner

- Confirm the 30-day backup and log windows.
- Decide whether to add automatic pruning of old instruction text and activity (not implemented; currently kept until deletion).
- Decide whether to require email verification before connecting services.
- Publish privacy policy and terms; confirm transcription and planning provider retention terms.
