# Kian

Standalone personal organiser web app. The first release is specified in `docs/superpowers/specs/2026-09-30-kian-first-release-design.md` and planned in `docs/superpowers/plans/2026-09-30-kian-first-release.md`.

## Development

Use Node 24 and pnpm 11.25.0. Run `pnpm install`, then `pnpm test`, `pnpm typecheck`, and `pnpm build`.

For the web app, set `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, and `VITE_FIREBASE_PROJECT_ID` for a Firebase project with Email/Password sign-in enabled. For the API, configure application default credentials for the same Firebase project and `DATABASE_URL`; run `pnpm db:migrate` on a fresh database before serving authenticated requests. These values belong in deployment secrets or local ignored environment files.

## Identity decision

Use Firebase Authentication for self-service email sign-up or federated sign-in. The web app obtains an ID token; the API validates it with the Firebase Admin SDK and uses the verified subject as the owner ID. Task 2 adds this. Required environment at deployment: Firebase project ID and a runtime service account authorized for token verification. Do not put service-account JSON or provider secrets in the repository.

## Status

Account isolation, typed/recorded instructions, proposals, per-task decisions, constrained trust and activity are implemented. Google Calendar authorization, encrypted token storage, renewal, writable calendar selection and its create/update adapter are available. Jira Cloud authorization/project selection, IONOS SMTP email and a durable execution worker are implemented. No live provider or staging demo has passed yet. Jira epic SFT-225 tracks implementation.

Google setup requires `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` and `KIAN_ENCRYPTION_KEY` (a base64-encoded 32-byte random key). Register the exact web app URL as the OAuth redirect URI. The web app completes authorization using its signed-in Firebase identity. Enable Calendar API and configure test users in Google Cloud before a private demo. Keep the encryption key in the deployment secret manager and preserve it across deployments. `OPENAI_API_KEY` enables planning/transcription. Set `VITE_API_URL` when the API has a separate origin.

Jira setup requires a Kian OAuth 2.0 (3LO) app registered in Atlassian Developer Console with `read:jira-work`, `write:jira-work` and `offline_access`. Configure `JIRA_CLIENT_ID`, `JIRA_CLIENT_SECRET`, and `JIRA_REDIRECT_URI` (the exact web app callback URL). Customers authorize their account, choose an accessible site, project, and issue type in Settings. Required fields are discovered from project metadata. Tokens stay encrypted on the API, and refresh-token rotation is persisted. No customer API token is collected. Live authorization and publishing to a dedicated demo project remain pending.

IONOS mailbox Settings verifies TLS SMTP access before saving encrypted credentials. The approved recipients, subject and body are sent once per task version. An uncertain send is never automatically retried. SMTP acknowledgement means accepted by the server, not delivered to an inbox, and does not guarantee a Sent-folder copy. Supported candidate hosts are smtp.ionos.co.uk, smtp.ionos.com and smtp.ionos.de on TLS port 465; a controlled live mailbox test must verify the chosen host before release.

The worker checks queued tasks every 15 seconds and resumes pending work after restart. Configure the runtime with continuous CPU (Cloud Run instance-based billing) for background execution. Interrupted in-flight work older than five minutes becomes uncertain and requires provider inspection.

## Release preparation

The Docker image now serves the web app and API together. See [demo runbook](docs/demo-runbook.md) and [operations](docs/operations.md) for configuration, live evidence requirements and recovery. `pnpm test:e2e` runs sandbox API journeys, not a live browser/provider demo. Teams, WhatsApp and Zoom remain planned integrations.
