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

## Browser security headers (SFT-329)

The API server adds these headers to every response (the page, web files, the API, errors and 404s) in `apps/api/src/security-headers.ts`:

| Header | Value | Why |
| --- | --- | --- |
| `Strict-Transport-Security` | one year, includeSubDomains | the browser only uses https for this site |
| `X-Content-Type-Options` | `nosniff` | no guessing of file types |
| `X-Frame-Options` and CSP `frame-ancestors` | `DENY` / `'none'` | no other site can embed Kian |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | other sites see the origin only |
| `Permissions-Policy` | microphone for Kian itself; camera, location, payment, USB and the like off | dictation works, nothing else |
| `Content-Security-Policy` | see below | only what the app uses can load or connect |

The content security policy allows: scripts, styles, fonts, API calls and manifest from the app itself; images from itself, `blob:` (the photos) and `data:`; media from `blob:` (dictation); connections to the Firebase email sign-in servers (`identitytoolkit.googleapis.com`, `securetoken.googleapis.com`); a frame from the Firebase sign-in domain `<firebase project>.firebaseapp.com` (taken from `GOOGLE_CLOUD_PROJECT`, or `KIAN_FIREBASE_AUTH_DOMAIN` if set). Nothing inline and no `unsafe-eval`; everything else is blocked (`default-src 'none'`).

**If something stops working after a release** (sign-in, a provider return page, dictation or the photos), open the browser console: a blocked request is named there ("Refused to ... because it violates the following Content Security Policy directive"). Two ways to loosen it:

1. **Quickest, no code change:** set `KIAN_CSP_MODE=report-only` on the Cloud Run service (`gcloud run services update <service> --region europe-west1 --update-env-vars KIAN_CSP_MODE=report-only`). The policy is then sent as `Content-Security-Policy-Report-Only`: the browser still lists violations in the console but blocks nothing. Remove the variable (`--remove-env-vars KIAN_CSP_MODE`) to enforce again.
2. **Permanent:** add the one needed source to the matching directive in `contentSecurityPolicy()`, with a test in `security-headers.test.ts`. Never add `'unsafe-inline'`, `'unsafe-eval'` or a wildcard.

**Check after a release:** `curl -sI https://kian.sepenta.io/` must list all six headers; do the same for `/settings` and `/health`. Then sign in, open Settings, record a short dictation and open the photos ("Who are you Kian?", "yes").

## Email providers (SFT-341)

Settings, Connections, **Connect email** connects any mailbox over SMTP. A person can connect several; each email card has a Connection list showing them by address, and the message is sent from the one chosen (with a single mailbox it is chosen automatically). Existing IONOS mailboxes keep working and appear in the same list.

| Provider | Server and port | What the person needs |
| --- | --- | --- |
| Gmail | smtp.gmail.com, 465 SSL | 2-Step Verification on, then Google account, Security, App passwords |
| Outlook.com / Hotmail | smtp-mail.outlook.com, 587 STARTTLS | an app password when two-step verification is on; Microsoft may refuse password sign-in for some accounts |
| Microsoft 365 | smtp.office365.com, 587 STARTTLS | the administrator must allow "Authenticated SMTP" for the mailbox; often switched off |
| Yahoo | smtp.mail.yahoo.com, 465 SSL | app password (Account security) |
| iCloud | smtp.mail.me.com, 587 STARTTLS | app-specific password (appleid.apple.com) |
| Zoho / Zoho EU | smtp.zoho.com or .eu, 465 SSL | application-specific password with two-factor |
| Fastmail | smtp.fastmail.com, 465 SSL | app password with SMTP access |
| GMX, mail.com | mail.gmx.com or smtp.mail.com, 587 STARTTLS | allow external programs to send mail in the settings |
| IONOS UK, US, Germany | smtp.ionos.co.uk, .com, .de, 465 SSL | mailbox address and password |
| Other server | typed by the person | outgoing server, port 25, 465, 587 or 2587; 465 means SSL, the others STARTTLS |

The presets live in `packages/connectors/src/mail-presets.ts` (server, port, security and the plain-words steps shown in Settings). To add a provider, add one entry there and a line in this table; the Settings list is served from the same data (`GET /connections/mailbox/presets`).

**Safety of "Other server".** Kian connects to whatever server the person types, so it is checked first (`mail-safety.ts`): a plain public DNS name only (no address literals, ports, paths, or single-label and internal suffixes such as .local, .internal, .lan); every address it resolves to must be public (loopback, private, link-local, carrier-grade NAT, documentation, multicast and the IPv6 and IPv4-mapped equivalents are refused); the connection then goes to the checked address while the certificate is verified for the typed name, so the name cannot be changed to an internal address between the check and the connection; only ports 25, 465, 587 and 2587; TLS is always required (SSL on 465, STARTTLS elsewhere), never plain text. The same check runs again on every test and every send. Presets use fixed servers and ignore any host sent by the browser.

**Failures are explained per provider**: wrong password, "this provider needs an app password" (with the provider's steps), "password sign-in is switched off" (Microsoft 365 and some Outlook accounts), server not found, secure connection failed, timeout, "that server is not allowed". Passwords are stored encrypted like the other connections, never returned and never logged (the mail library's logging is off). Sending rules are unchanged: the card shows the exact recipients, subject and text; one send; an uncertain send is never retried automatically.

**Limits.** Password sign-in is being phased out by Google and Microsoft: some Gmail and most Microsoft 365 organisations cannot use it. One-click Gmail (SFT-342) and Outlook / Microsoft 365 (SFT-343) sign-in are planned and need the owner to add the permissions to the Google app and to register an Azure app.

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
