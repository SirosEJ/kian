# Kian operations

## Build and run

Use Node 24 and pnpm 11.25.0. Install with `pnpm install --frozen-lockfile`. Verify with `pnpm test`, `pnpm test:e2e`, `pnpm typecheck` and `pnpm build`.

`pnpm db:migrate` applies tracked migrations once under a database advisory lock. The initial migration targets a fresh database. If a development database was manually initialized from an earlier checkpoint, back it up and recreate the dedicated staging database; do not reapply the initial SQL over an existing schema.

Build `Dockerfile` with public `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN` and `VITE_FIREBASE_PROJECT_ID` build arguments. The image serves the compiled web app and API on port 8080. OAuth callback URLs must point to `/`. This same-origin setup needs no separate browser API URL. Firebase client values are public configuration; provider credentials and service accounts are runtime secrets.

For a local compiled run, set `WEB_DIST_PATH` to the absolute `apps/web/dist` directory, provide runtime secrets and launch `node apps/api/dist/server.js`. `/health` is a process health check, not a provider readiness check.

No staging cloud resources or paid production services have been created by this implementation. Container build/start and Cloud Run deployment must be verified in the configured environment; Docker is not available in the development workspace used for local verification.

## Secrets and account configuration

Supply `DATABASE_URL`, Firebase application default credentials and project ID, `OPENAI_API_KEY`, Google and Jira OAuth client values and one persistent base64 32-byte `KIAN_ENCRYPTION_KEY`. Store them in the deployment secret manager. Never commit customer mailbox passwords or OAuth tokens. Losing or rotating the encryption key without re-encryption makes saved connections unusable; ask users to reconnect.

Google and Jira credentials stay server-side encrypted. Customers authorize their own account and choose writable destinations in Settings. IONOS credentials are verified via TLS SMTP and encrypted before storage. A disconnect clears stored credentials and revokes associated trust. It does not necessarily revoke the provider-side application grant; users can also remove that grant in their provider account.

## Worker and recovery

The API executes an approved task immediately and scans durable queued tasks every 15 seconds. Run with continuous CPU, for example Cloud Run instance-based billing; request-only CPU cannot guarantee timely background work. The unique execution claim prevents a task version from running twice across concurrent instances.

No automatic retries are performed for failed or uncertain executions. An interrupted running claim older than five minutes becomes uncertain. Check the external calendar, Jira project or recipient before preparing a new task. A manually approved task remains approved if a future trust rule is revoked. A task queued by trust rechecks that rule before execution and returns to review if the rule was revoked. A subsequent explicit approval clears the obsolete trust basis. Calendar and Jira updates always require review in the first release. Jira proposals snapshot the site and issue type; changing Jira mappings revokes trust and returns pending tasks to review. Execution results, task state and activity are saved in one transaction, and recovery reconciles terminal receipts.

Watch queued age, uncertain outcomes, authentication failures and worker error logs. Do not log request bodies or decrypted connections. PostgreSQL backups must be encrypted and access limited. Preserve the runtime encryption key separately from the database backup.

## Retention and deletion decisions before launch

Instructions, proposals, trust rules, execution receipts and activity remain until account deletion. Raw microphone audio is not saved to the database; it is sent to the transcription provider, whose account retention settings must be confirmed. Instruction text is sent to the planning provider. Select retention periods, disclose these data flows, document support access and publish privacy/terms before public onboarding.

Self-service account deletion and scheduled retention pruning are not implemented. For an authenticated, verified deletion request, the operator deletes the corresponding `users` row using a parameterized UID query (dependent customer records cascade), deletes the Firebase user and revokes provider grants as appropriate. Deletion does not delete objects already created in external providers. Test the procedure in staging and define how backups expire before launch.

## Release checklist

The public repository contains source, not a launched product. Release only after the live journey in `demo-runbook.md`, container smoke test, deployment secret configuration, provider application readiness and privacy/retention decisions pass. Capture concrete evidence before changing demo status to live.
