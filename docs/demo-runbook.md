# Kian first-release verification

## Current gate

Implementation is saved in https://github.com/SirosEJ/kian. Local unit, sandbox API journeys, type checks and builds are used to validate code. They do not prove delivery through a live provider or a public deployment. The release remains blocked until the checks below pass with configured accounts.

| Area | Automated coverage | Live evidence still needed |
| --- | --- | --- |
| Accounts | Token rejection and owner isolation | Fresh Firebase sign-up/sign-in in two browsers |
| Instructions | Schema, text intake, audio size, transcription retry | Real microphone recording, correction and text intake |
| Decisions | Separate approvals, version conflicts, reject, trust/revoke | Review and settings browser journey |
| Calendar | OAuth state ownership, renewal, destination, create/update | Google test account consent and an event link |
| Jira | Authorized sites, projects, types, field validation, renewal | Jira demo project create/update and issue link |
| Email | Encrypted credential store, exact draft, SMTP acceptance, uncertainty | Authorized IONOS mailbox and controlled recipient receipt |
| Recovery | Durable per-version claim, interrupted send, no automatic resend | Restart a staging instance and inspect Activity |
| Hosting | Root callback, compiled asset and API routing | HTTPS staging URL and container build/start |

## Setup

1. Use a separate Firebase project and Postgres database for staging. Enable Firebase Email/Password authentication and add the staging domain to authorized domains. Supply server application default credentials for that project.
2. Copy `.env.example` into ignored configuration, fill values through a secret manager, run `pnpm install --frozen-lockfile`, then `pnpm db:migrate` on the empty staging database.
3. Register Google Calendar OAuth and an Atlassian 3LO app. Configure callback URLs to the exact Kian root URL with the trailing slash; allow Google test users and enable Calendar API. Jira scopes are `read:jira-work`, `write:jira-work`, `offline_access`.
4. Build and deploy the container using the three public Firebase build arguments. Keep provider client secrets, OpenAI API key, database URL and the encryption key in runtime secrets. Use continuous CPU for the task worker. See `operations.md`.
5. Create two Kian test accounts. In Settings, connect a writable test calendar, a dedicated Jira project and story type, and a controlled IONOS mailbox. Verify the correct IONOS regional SMTP host with the mailbox owner.

## Live journey to record

Record date, commit, browser, staging URL, each result link or receipt and operator initials in `docs/live-evidence.md` once the following have actually passed.

1. Sign up Alice and Bob. Record a short instruction, correct the transcript and submit. Also submit typed text with one calendar event, Jira story and email. Specify exact recipient addresses, dates with offsets and a time zone. Verify no provider writes before approval.
2. Edit each proposal in the UI, selecting its connection and destination. Check every displayed field. Approve the calendar and Jira tasks separately, reject one extra task and approve the email. Verify event, issue and recipient receipt, and check Activity. Refresh the page and confirm task states persist.
3. Trust one create/send task for its connection and exact destination, submit a matching instruction and confirm automatic execution. Change the recipient/project/calendar and confirm manual approval is required. Revoke trust and confirm the next matching task asks approval. Confirm a task returned from revoked trust can execute after explicit approval. Change Jira site or issue type and verify existing pending tasks ask for a fresh review; confirm update actions always require approval.
4. Attempt Bob access to Alice task and connection IDs and decision endpoints. Verify 404/denial and no task, activity, connection or secret leakage. Revoke a provider token and ensure execution produces visible failure or uncertainty without an unintended write.
5. Introduce one provider failure in a multi-task instruction. Verify other tasks retain their own outcomes. Interrupt an in-flight email after SMTP acceptance in the sandbox. Restart and wait for recovery; inspect the recipient before considering a new task. Verify the worker does not resend that task version.

SMTP acceptance is not proof of recipient delivery. Kian does not append SMTP messages to a Sent folder. Check recipient receipt and record the stable Message-ID. An uncertain result requires inspection, never a blind retry.

## Demo reset and fallback

Use dedicated accounts and recognizable test titles. Delete only the demo provider objects you have recorded. Disconnect the test connections and revoke trust after the session. Preserve evidence until its agreed retention period ends. If a provider is unavailable, show the saved sandbox test output or a previously verified recording and clearly state that the live provider is unavailable.

Teams, WhatsApp and Zoom are later integrations and are not part of this release gate.

## Verification checkpoint: 30 September 2026

- `pnpm test`: 38 tests passed (27 API, 7 connector, 3 web rendering, 1 database). API total includes the two sandbox journey tests.
- `pnpm test:e2e`: both sandbox API journeys passed.
- `pnpm typecheck` and `pnpm build`: passed.
- Compiled server smoke: web root 200, generated JavaScript asset 200, health 200, unauthenticated tasks 401.
- Independent code review: identified consent, mapping, persistence and startup defects; fixes reviewed with no remaining important finding. Regression tests cover revoked-trust manual approval, mapping changes, atomic receipt rollback, terminal reconciliation and claim/start invalidation.
- Pending: Firebase/browser microphone journey, controlled Google/Jira/IONOS live writes, Docker image smoke, staging deployment and launch privacy/retention decisions. No production launch claimed.
