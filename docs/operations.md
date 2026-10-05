# Kian operations

## Build and run

Use Node 24 and pnpm 11.25.0. Install with `pnpm install --frozen-lockfile`. Verify with `pnpm test`, `pnpm test:e2e`, `pnpm typecheck` and `pnpm build`.

`pnpm db:migrate` applies tracked migrations once under a database advisory lock. The initial migration targets a fresh database. If a development database was manually initialized from an earlier checkpoint, back it up and recreate the dedicated staging database; do not reapply the initial SQL over an existing schema.

Build `Dockerfile` with public `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN` and `VITE_FIREBASE_PROJECT_ID` build arguments. The image serves the compiled web app and API on port 8080. OAuth callback URLs must point to `/`. This same-origin setup needs no separate browser API URL. Firebase client values are public configuration; provider credentials and service accounts are runtime secrets.

For a local compiled run, set `WEB_DIST_PATH` to the absolute `apps/web/dist` directory, provide runtime secrets and launch `node apps/api/dist/server.js`. `/health` is a process health check, not a provider readiness check.

No staging cloud resources or paid production services have been created by this implementation. Container build/start and Cloud Run deployment must be verified in the configured environment; Docker is not available in the development workspace used for local verification.

## Staging and story previews

`kian-staging` is a stable Cloud Run service deployed from `main` by `.github/workflows/staging.yml` (own Neon branch `kian-staging`). Its URL is `https://kian-staging-1088794188480.europe-west1.run.app/`. Register exactly this URL, with the trailing slash, as the OAuth redirect for the Google app. Register it for the Atlassian app too: Atlassian stores it without the trailing slash, so the workflow sends Jira the address without one (`JIRA_REDIRECT_URI`), while Google keeps the slash. Provider connections are tested here only. Story previews (`kian-sft-N`, `preview.yml`) have changing URLs and are for everything except provider OAuth.

To enable a provider on staging, set the GitHub repository variable `KIAN_GOOGLE_CLIENT_ID` / `KIAN_JIRA_CLIENT_ID`, create the Secret Manager secret `kian-google-client-secret` / `kian-jira-client-secret`, and grant the Cloud Run runtime service account (`<project number>-compute@developer.gserviceaccount.com`) `roles/secretmanager.secretAccessor` on that secret. The workflow switches a provider on when its variable is set (and warns when it is not); create the secret first, because the deployer is deliberately not allowed to look secrets up, so a missing secret shows up as a Cloud Run deploy error naming it. Secret values are created by the owner and never committed.

## Production

Production is a separate Cloud Run service, `kian-prod` (europe-west1), served at `https://kian.sepenta.io/`. It has its own Neon database, its own encryption key and its own Firebase project; nothing is shared with `kian-staging` or the story previews. It runs with one instance always on and continuous CPU, because the task worker needs it.

### Releasing

Run the workflow "Deploy Production" (Actions tab, or `gh workflow run production.yml -f sha=<40-character sha>`). It:

1. checks the commit is on `main` and that its own "Deploy Staging" run succeeded (`scripts/verify-release-candidate.sh`; otherwise it stops);
2. runs the full test suite on exactly that commit;
3. waits for a required reviewer to approve the run in the GitHub `production` environment;
4. checks the production variables below and stops with a list of any that are missing (secrets cannot be checked ahead of time; Cloud Run names a missing or unreadable one when it deploys);
5. deploys that commit (labelled `commit=<first 12 characters>`), runs the database migrations on start, and checks `/health`. The run summary shows the previous revision, the rollback command, and whether `https://kian.sepenta.io/health` already answers.

Only commits that reached staging can be released. If staging has not deployed the commit you want (a newer merge replaced it in the queue), release the newer one, or re-run "Deploy Staging" for it first.

### Rolling back

Send traffic back to the previous revision (the run summary prints the exact command):

```bash
gcloud run services update-traffic kian-prod --project <project> --region europe-west1 --to-revisions=<previous-revision>=100
```

Migrations only move forward and are not undone by a rollback. A release that changes the database must stay compatible with the previous revision for one release, or be fixed forward by a new release.

### Owner prerequisites (one time; the agent never does these)

1. **Firebase project for production**: a separate project with Authentication > Email/Password enabled and `kian.sepenta.io` added under authorized domains. Note its web API key, auth domain and project ID.
2. **Neon database for production**: a separate Neon project (or at least a separate database and role) for production. Store its non-pooled connection string as the Secret Manager secret `kian-prod-database-url`.
3. **Secrets** in Secret Manager (values never go in GitHub, the repo or chat): `kian-prod-database-url`, `kian-prod-encryption-key` (a new base64 32-byte key, not the staging key; losing it makes saved connections unusable), and access to the OpenAI key secret (`estate-openai-api-key`, or another secret named in the variable `KIAN_OPENAI_SECRET`). For the production OAuth apps: `kian-prod-google-client-secret` and `kian-prod-jira-client-secret` (never the staging `kian-google-client-secret` / `kian-jira-client-secret`).
4. **Runtime access**: the Cloud Run runtime service account needs `roles/secretmanager.secretAccessor` on each secret above, and `roles/firebaseauth.viewer` on the production Firebase project (same as staging needed).
5. **GitHub environment `production`** (Settings > Environments): required reviewers (at least you), and these environment variables: `GCP_WORKLOAD_IDENTITY_PROVIDER`, `GCP_DEPLOYER_SERVICE_ACCOUNT` (a deployer that may deploy `kian-prod` and read the secrets' metadata; do not reuse a broader identity than needed), `GCP_PROJECT_ID`, `KIAN_FIREBASE_API_KEY`, `KIAN_FIREBASE_AUTH_DOMAIN`, `KIAN_FIREBASE_PROJECT_ID`, and, for the production OAuth apps, `KIAN_PROD_GOOGLE_CLIENT_ID` and `KIAN_PROD_JIRA_CLIENT_ID` (set as `production` environment variables; the staging `KIAN_GOOGLE_CLIENT_ID` / `KIAN_JIRA_CLIENT_ID` are repository-level and are deliberately not used for production).
6. **Domain**: after the first deploy, map the domain and add the DNS record it asks for:

   ```bash
   gcloud beta run domain-mappings create --service kian-prod --domain kian.sepenta.io --region europe-west1 --project <project>
   gcloud beta run domain-mappings describe --domain kian.sepenta.io --region europe-west1 --project <project>
   ```

   The second command shows the DNS record (usually a CNAME to `ghs.googlehosted.com.`). Managed TLS takes a short while to become active.
7. **OAuth apps** (when you connect providers): create separate production apps. Google: a new OAuth client with the redirect `https://kian.sepenta.io/` (with the trailing slash). Atlassian: a new OAuth 2.0 (3LO) app with the callback `https://kian.sepenta.io` (Atlassian stores it without the slash and production sends it without one), scopes `read:jira-work` and `write:jira-work`. Create the secrets in step 3 and set the client ID variables in step 5.

Production never contains test credentials. Launch gates that are not part of the deploy: the live journey (SFT-232) and the privacy, terms and retention decisions in `account-lifecycle.md` before public sign-up.

## Command evaluation (does Kian understand what people ask?)

`apps/api/src/eval/cases.ts` is the verified set of commands: the owner's real phrases from staging plus the canonical requests (Jira and calendar questions, status changes, creating events, issues and emails, and honesty cases such as unsupported requests, a service that is not connected, and instructions hidden in event titles). Each case says whether a good answer looks something up, prepares actions for approval, or only replies, and has an example answer that must pass and, for real failures, a bad answer that must fail.

* On every CI run (`pnpm test`): the cases are checked against the real validator, so the set can never drift from the code. No model is called.
* Against the real model: run `pnpm --filter @kian/api eval:live` (needs `OPENAI_API_KEY` in your shell, about 30 questions per run) or the GitHub workflow **Evaluate Kian commands** (manual, and after each successful staging deploy). It prints pass rate, clarification rate (questions asked where it should have acted), actions prepared that nobody asked for, and precision and recall per outcome, and compares with `apps/api/eval/baseline.json` when that file exists. The run turns red below 85% or if any unrequested action is prepared. It is advisory and never blocks a deploy.
* Owner prerequisite, once: add the repository secret `OPENAI_API_KEY` (GitHub, Settings, Secrets and variables, Actions). Without it the workflow skips the model run and says so.
* After a planner or prompt change, run it before and after and keep the better numbers as the new baseline (`--out eval/baseline.json`).

## Story preview cleanup

Each story preview creates a Cloud Run service and a Neon database branch, both named `kian-sft-<N>`. The Neon project has a branch limit; when it is reached, preview deploys fail with Neon's own message ("branches limit exceeded"). `.github/workflows/preview-cleanup.yml` removes both automatically when a pull request from an `SFT-<N>-...` branch closes, merged or not (pull requests from this repository only). It uses `scripts/cleanup-story-preview.sh`, which only builds the name `kian-sft-<digits>`, so it cannot touch `kian-staging`, production, or the Neon default branch (which it also refuses explicitly), and running it twice is harmless.

To clean a story by hand (for example one merged before this existed), run the workflow "Clean Up Story Preview" from the Actions tab with the story number. It is a dry run by default (it only lists what it would delete); untick "dry run" to delete. The same script works locally with `GCP_PROJECT_ID`, `NEON_API_KEY` and `NEON_PROJECT_ID` set: `scripts/cleanup-story-preview.sh 226 --dry-run`. The staging deployer already holds `run.services.delete` through `roles/run.sourceDeveloper`, so no extra permission is needed.

## App pages and OAuth return

The web app has four pages: Home `/`, Activity `/activity`, Settings `/settings` and Account `/account` (reached from the profile menu at the top right). The API serves the app for a browser load of these paths (a request that accepts `text/html`); the app's own requests to `/activity` and other API paths still get JSON. Unknown paths return a 404 JSON error from the API. OAuth redirect URLs stay as the site root with a trailing slash (`https://<host>/`): the app moves that return to `/settings?code=...&state=...` before the page loads, where the connection is completed. Do not register `/settings` as a redirect.

## Microsoft Teams (SFT-335, connection from SFT-336)

Kian connects to Teams through Microsoft Graph with each person's own delegated sign-in (authorization code with PKCE and a client secret). Kian never holds an organisation-wide key, and it can only see and do what the signed-in person can.

**Microsoft Entra app (owner action, one time)**

1. Entra admin centre, Identity, Applications, App registrations, New registration. Name `Kian`. Account type: any organizational directory (multitenant), or this directory only if only your own company will use it. Not personal Microsoft accounts (Teams chat needs a work or school account).
2. Redirect URIs, platform **Web**, exactly: `https://kian-staging-1088794188480.europe-west1.run.app/` and `https://kian.sepenta.io/` (with the trailing slash).
3. API permissions, Microsoft Graph, **Delegated**: `User.Read`, `offline_access`, `Chat.Read`, `Chat.ReadWrite`, `ChatMessage.Send`. Then **Grant admin consent**. If the button is not available, a Global Administrator or Privileged Role Administrator must do it. Without approval the user sees: "Microsoft needs an administrator of your organisation to approve Kian before you can connect."
4. Certificates and secrets, New client secret (note its expiry date: when it expires, connecting and refreshing stop until a new value is stored). The value is shown once.

**Settings Kian reads (names only; values never go in the repo or in chat)**

| What | Staging | Production |
| --- | --- | --- |
| GitHub variable: application (client) ID | `KIAN_TEAMS_CLIENT_ID` | `KIAN_PROD_TEAMS_CLIENT_ID` |
| GitHub variable (optional): directory (tenant) ID, default `organizations` | `KIAN_TEAMS_TENANT` | `KIAN_PROD_TEAMS_TENANT` |
| Secret Manager secret: client secret value | `kian-teams-client-secret` | `kian-prod-teams-client-secret` |

The deploy workflows turn Teams on only when the client ID variable is set; the Cloud Run runtime service account needs `roles/secretmanager.secretAccessor` on the secret. Without the variable, Settings shows the Connect button but answers "Microsoft Teams is not available yet."

**Storing the secret (Cloud Shell, never in chat)** (staging shown; use the `kian-prod-` name for production):

```bash
printf '%s' 'PASTE-THE-SECRET-VALUE-HERE' | gcloud secrets create kian-teams-client-secret --data-file=- --project <project id>
gcloud secrets add-iam-policy-binding kian-teams-client-secret --member="serviceAccount:<project number>-compute@developer.gserviceaccount.com" --role=roles/secretmanager.secretAccessor --project <project id>
```

**Stored data and removal.** Tokens are encrypted with `KIAN_ENCRYPTION_KEY` like the other providers; the sign-in's PKCE verifier lives in `oauth_states.code_verifier` for at most ten minutes and is cleared when used. Disconnect in Settings clears the stored tokens. To also remove Kian's access on the Microsoft side, a user opens https://myapps.microsoft.com (or an admin uses Enterprise applications, Kian, Delete) and removes the app.

**Loosening or reducing permissions.** Reading chats needs `Chat.Read`; sending needs `ChatMessage.Send`. If the organisation refuses the sending permission, remove it from `TEAMS_SCOPES` in `packages/connectors/src/microsoft-teams.ts` and from the Entra app; reading keeps working and the send story (SFT-338) stays switched off.

## Secrets and account configuration

Supply `DATABASE_URL`, Firebase application default credentials and project ID, `OPENAI_API_KEY`, Google and Jira OAuth client values and one persistent base64 32-byte `KIAN_ENCRYPTION_KEY`. Store them in the deployment secret manager. `KIAN_PLANNING_MODEL` (optional) is a comma separated list of OpenAI models tried in order for Kian's conversation, default `gpt-4.1,gpt-4o`; an unavailable model falls through to the next. Conversation limits (4000 characters per message, 200 messages per conversation, 40 messages per user per 10 minutes, last 20 messages sent to the model) are in `apps/api/src/modules/conversations/service.ts`. Migrations run automatically on deploy; `002_conversations.sql` adds conversations and messages. Never commit customer mailbox passwords or OAuth tokens. Losing or rotating the encryption key without re-encryption makes saved connections unusable; ask users to reconnect.

Google and Jira credentials stay server-side encrypted. Customers authorize their own account and choose writable destinations in Settings. IONOS credentials are verified via TLS SMTP and encrypted before storage. A disconnect clears stored credentials and revokes associated trust. It does not necessarily revoke the provider-side application grant; users can also remove that grant in their provider account.

## Worker and recovery

The API executes an approved task immediately and scans durable queued tasks every 15 seconds. Run with continuous CPU, for example Cloud Run instance-based billing; request-only CPU cannot guarantee timely background work. The unique execution claim prevents a task version from running twice across concurrent instances.

No automatic retries are performed for failed or uncertain executions. An interrupted running claim older than five minutes becomes uncertain. Check the external calendar, Jira project or recipient before preparing a new task. A manually approved task remains approved if a future trust rule is revoked. A task queued by trust rechecks that rule before execution and returns to review if the rule was revoked. A subsequent explicit approval clears the obsolete trust basis. Calendar and Jira updates always require review in the first release. Jira proposals snapshot the site and issue type; changing Jira mappings revokes trust and returns pending tasks to review. Execution results, task state and activity are saved in one transaction, and recovery reconciles terminal receipts.

Watch queued age, uncertain outcomes, authentication failures and worker error logs. Do not log request bodies or decrypted connections. PostgreSQL backups must be encrypted and access limited. Preserve the runtime encryption key separately from the database backup.

## Retention and deletion decisions before launch

Instructions, proposals, trust rules, execution receipts and activity remain until account deletion. Raw microphone audio is not saved to the database; it is sent to the transcription provider, whose account retention settings must be confirmed. Instruction text is sent to the planning provider. Select retention periods, disclose these data flows, document support access and publish privacy/terms before public onboarding.

Self-service account deletion is implemented (`DELETE /account`, see `account-lifecycle.md`); scheduled retention pruning is not. For a manual deletion request, the operator deletes the corresponding `users` row using a parameterized UID query (dependent customer records cascade), deletes the Firebase user and revokes provider grants as appropriate. Deletion does not delete objects already created in external providers. Test the procedure in staging and define how backups expire before launch.

## Release checklist

The public repository contains source, not a launched product. Release only after the live journey in `demo-runbook.md`, container smoke test, deployment secret configuration, provider application readiness and privacy/retention decisions pass. Capture concrete evidence before changing demo status to live.
