# Kian First Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone, multi-user Kian web app that turns voice or typed instructions into confirmed or narrowly trusted actions in Google Calendar, Jira Cloud, and IONOS email.

**Architecture:** A React web client talks to a Fastify API. The API owns user-scoped task state, connection references, confirmation and trust policy. A worker executes typed connector commands and records outcomes; AI text is untrusted input and cannot authorize a write.

**Tech Stack:** New private GitHub repository `SirosEJ/kian` (proposed name), pnpm/TypeScript monorepo, React/Vite web client, Fastify API, PostgreSQL, Vitest, Cloud Run. Use a managed OIDC identity service selected during Task 1; do not create a custom password database. Match Sepenta's existing pnpm, TypeScript, Fastify, PostgreSQL and Cloud Run conventions where practical. Pin current supported dependency versions and confirm provider capabilities during implementation.

**Spec:** `Kian-first-release-design.md` (30 September 2026, approved). Copy this spec into the repository as `docs/superpowers/specs/2026-09-30-kian-first-release-design.md` when the repository is created.

## Global Constraints

- Kian is a separate product, deployment, database and customer data boundary from Business Discovery and Delivery Console.
- A fresh user can sign up. Every task, connection, rule and activity record is scoped to its authenticated owner on the server.
- The first demo uses Google Calendar, Jira Cloud and Sepenta's IONOS mailbox. Other providers are later work.
- Typed and browser-recorded voice input both lead to reviewable per-task proposals.
- No provider write occurs without an explicit per-task approval or a matching, active, constrained trust rule.
- New recipient, project or calendar, destructive change, ambiguity, low confidence or revoked rule returns to review.
- Do not expose saved provider secrets in the browser or operational logs; disconnect prevents future use.
- Provider execution is idempotent where possible. An uncertain email send is not automatically retried.

## Review Focus

1. A voice transcript saying “Friday” near a time-zone/date boundary must ask for clarification if the intended date is ambiguous; Task 3 tests it.
2. A multi-task instruction with one rejected task must execute only approved tasks; Task 4 tests it.
3. A trusted email action with a new recipient must require review; Task 4 tests it.
4. Two signed-in users must not access one another's connection or task by guessing an ID; Task 2 tests it.
5. A timeout after SMTP accepted a message must show an uncertain result and never resend automatically; Task 7 tests it.

## Proposed repository map

- `apps/web/src/routes/`: sign-in, dashboard, task review, activity and settings pages.
- `apps/web/src/features/recording/`: browser recording and transcript correction.
- `apps/api/src/modules/identity/`: OIDC session validation and user mapping.
- `apps/api/src/modules/tasks/`: instruction intake, proposals, approvals, task state and activity.
- `apps/api/src/modules/trust/`: constrained trust-rule evaluation and revocation.
- `apps/api/src/modules/connections/`: provider connection lifecycle and discovery.
- `apps/api/src/modules/execution/`: idempotent execution and result handling.
- `packages/contracts/src/`: shared task, connection, and provider result schemas.
- `packages/connectors/src/`: Google Calendar, Jira Cloud, and IONOS mail adapters.
- `packages/db/migrations/`: user, connection, instruction, task, rule and activity tables.
- `tests/e2e/`: browser and provider-sandbox journeys.

These are paths for a new repository, not claims that the repository exists yet. Create it only after plan review and execution choice.

---

### Task 1: Standalone app shell and deployment path

**Files:** Create root `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `apps/web/package.json`, `apps/api/package.json`, `apps/web/src/main.tsx`, `apps/api/src/server.ts`, `.github/workflows/ci.yml`, `Dockerfile`, `docs/superpowers/specs/2026-09-30-kian-first-release-design.md`; test `apps/api/src/server.test.ts`.

**Interfaces:** Produce `buildServer(): FastifyInstance` and `GET /health` returning `{status:"ok"}`. Choose a managed OIDC provider that supports self-service sign-up and server-verified subject IDs; document its environment configuration, without secrets, in `README.md`.

- [ ] Write `server.test.ts` asserting `GET /health` returns 200 and `{status:"ok"}`.
- [ ] Run `pnpm --filter @kian/api test server.test.ts`; expect the missing server test to fail.
- [ ] Create the minimal workspace, React shell, Fastify server, CI typecheck/test/build, container and deployment configuration; place the approved spec in the repository.
- [ ] Run `pnpm install --frozen-lockfile`, `pnpm test`, `pnpm typecheck`, and `pnpm build`; expect all to pass and a local health response.
- [ ] Commit `feat: establish standalone Kian app`.

### Task 2: User identity, data isolation and connection references

**Files:** Create `apps/api/src/modules/identity/session.ts`, `apps/api/src/modules/identity/session.test.ts`, `packages/db/migrations/001_core.sql`, `packages/db/src/repositories.ts`, `packages/db/src/repositories.test.ts`, `apps/web/src/routes/SignIn.tsx`.

**Interfaces:** Produce `requireUser(request): Promise<UserId>` from a verified OIDC token; `getTask(ownerId:UserId,taskId:TaskId): Promise<Task|null>` and `getConnection(ownerId:UserId,connectionId:ConnectionId): Promise<Connection|null>`. IDs are opaque; repository queries include owner ID.

- [ ] Write tests for valid/invalid identity and for two users with guessed task and connection IDs; assert cross-user reads and writes return 404/deny.
- [ ] Run targeted Vitest files; expect failures before implementation.
- [ ] Add OIDC validation, user upsert, owner-scoped tables/repositories, protected routes, and a self-service sign-in screen.
- [ ] Run targeted tests and `pnpm typecheck`; expect pass.
- [ ] Commit `feat: isolate Kian user accounts`.

### Task 3: Instruction intake and typed task proposals

**Files:** Create `packages/contracts/src/tasks.ts`, `apps/api/src/modules/tasks/plan.ts`, `apps/api/src/modules/tasks/plan.test.ts`, `apps/api/src/modules/tasks/routes.ts`, `apps/web/src/features/recording/Recorder.tsx`, `apps/web/src/routes/Dashboard.tsx`, tests beside components.

**Interfaces:** Define `TaskProposal` as `{id,action,connectionId,destination,parameters,uncertainties,state:"proposed"}` and `planInstruction(ownerId,text,locale,timeZone): Promise<TaskProposal[]>`. The planner returns schema-validated proposals; it never calls a connector. `POST /instructions` accepts corrected text; `POST /transcriptions` accepts bounded browser audio and returns editable text.

- [ ] Write tests: one text request becomes a proposal, two actions become two proposals, “Friday” without a clear date asks clarification, malformed model output cannot reach execution, failed transcription can retry.
- [ ] Run targeted Vitest tests; expect failures.
- [ ] Implement typed schemas, planner, transcription endpoint and browser recorder with transcript correction; persist proposal versions.
- [ ] Run targeted tests and browser recording smoke test; expect no external writes.
- [ ] Commit `feat: propose tasks from voice and text`.

### Task 4: Confirmation, constrained trust and activity history

**Files:** Create `apps/api/src/modules/trust/policy.ts`, `apps/api/src/modules/trust/policy.test.ts`, `apps/api/src/modules/tasks/approval.ts`, `apps/api/src/modules/tasks/approval.test.ts`, `apps/api/src/modules/tasks/activity.ts`, `apps/web/src/routes/TaskReview.tsx`, `apps/web/src/routes/Activity.tsx`, `apps/web/src/routes/Settings.tsx`.

**Interfaces:** `evaluateTrust(ownerId,proposal,activeRules): {allowed:boolean;ruleId?:string;reason?:string}`; `decideTask(ownerId,taskId,version,"approve"|"reject",optionalRule): Promise<Task>`; `listActivity(ownerId): Promise<Activity[]>`. Approval uses optimistic task versioning; any edit invalidates a prior approval. A rule specifies owner, connection, action, and allowed destinations/recipient scope.

- [ ] Write tests for approve, edit, reject and mixed multi-task cases; cross-user decisions; matching rule; new recipient/project/calendar; revoked rule; destructive/ambiguous proposal; repeated approval requests.
- [ ] Run targeted tests; expect failures.
- [ ] Implement policy and task state transitions, review UI, rule list/revocation and activity feed.
- [ ] Run targeted tests and a browser review journey; expect only allowed tasks to be queued.
- [ ] Commit `feat: require task approval and enforce trusted actions`.

### Task 5: Connection lifecycle and Google Calendar adapter

**Files:** Create `packages/contracts/src/connections.ts`, `apps/api/src/modules/connections/routes.ts`, `apps/api/src/modules/connections/routes.test.ts`, `packages/connectors/src/google-calendar.ts`, `packages/connectors/src/google-calendar.test.ts`, `apps/web/src/routes/Settings.tsx`.

**Interfaces:** `Connector` exposes `connect`, `test`, `listDestinations`, `validate`, `execute`, `disconnect`; `GoogleCalendarConnector.execute(command,idempotencyKey): Promise<ExecutionResult>`. The settings API returns safe metadata only. OAuth callback validates state and owner; tokens are encrypted or held by an approved secret store.

- [ ] Write mocked-provider tests for valid state, wrong state/user, revoked token, selecting a calendar, date/time-zone validation, create/update, and disconnect blocking use.
- [ ] Run targeted tests; expect failures.
- [ ] Implement the lifecycle, selected-calendar metadata, Google Calendar adapter and user settings UI.
- [ ] Run tests and a real test-calendar smoke check with a nonproduction account; confirm created event link and no secret leakage.
- [ ] Commit `feat: connect Google Calendar`.

### Task 6: Jira Cloud adapter

**Files:** Create `packages/connectors/src/jira.ts`, `packages/connectors/src/jira.test.ts`, Jira connection screens in `apps/web/src/routes/Settings.tsx`, and connector route tests.

**Interfaces:** `JiraConnector.listDestinations(connection): Promise<{siteId,projectKey,name,issueTypes}[]>`; `execute` takes a typed create/update command and returns issue key/link. Field mappings are discovered and validated per selected project.

- [ ] Write tests for site authorization, project discovery, limited permissions, unsupported issue type/field, create/update, revoked access, and wrong project under a trust rule.
- [ ] Run targeted tests; expect failures.
- [ ] Implement Jira authorization, project selection, field validation and execution through the connector interface.
- [ ] Run tests and a smoke check in a dedicated demo Jira project; confirm issue key/link.
- [ ] Commit `feat: connect Jira Cloud`.

### Task 7: IONOS email adapter and safe send semantics

**Files:** Create `packages/connectors/src/ionos-mail.ts`, `packages/connectors/src/ionos-mail.test.ts`, mailbox settings screen in `apps/web/src/routes/Settings.tsx`, and `apps/api/src/modules/execution/runner.ts` with tests.

**Interfaces:** `IonosMailConnector.validate` checks recipients, subject and body. `execute` sends exactly the approved version and returns `sent`, `failed`, or `uncertain`. A Kian draft is stored locally until approved. The implementation plan must verify IONOS's supported SMTP/app-credential method using an authorized test mailbox before choosing the transport; never log credentials.

- [ ] Write tests for recipient ambiguity, edited body invalidating approval, credential failure, successful send, duplicate execution key, and timeout after provider acceptance marked `uncertain` without automatic retry.
- [ ] Run targeted tests; expect failures.
- [ ] Implement encrypted mailbox connection, local drafts, SMTP send and result records with conservative retry behavior.
- [ ] Run tests and a real send to a controlled test recipient; verify content, Sent/receipt evidence if available, and no duplicate.
- [ ] Commit `feat: connect IONOS email safely`.

### Task 8: End-to-end release gate

**Files:** Create `tests/e2e/kian-journey.spec.ts`, `tests/e2e/isolation.spec.ts`, `docs/demo-runbook.md`, `docs/operations.md`; adjust only defects exposed by these tests.

**Interfaces:** Test the public web UI and real or sandboxed provider accounts. The runbook lists setup, reset, fallback evidence and visible demo status per provider.

- [ ] Write end-to-end tests for sign-up, voice correction, text input, multiple proposals, approve/reject, Google event, Jira issue, IONOS email, trust/revoke, two-account isolation, expired connection and partial failure.
- [ ] Run the tests against a fresh staging environment; expect failures before any necessary integration fix.
- [ ] Fix only observed blockers, record provider setup, retention/deletion settings and recovery steps.
- [ ] Run `pnpm test`, `pnpm typecheck`, `pnpm build`, end-to-end tests and a manual live three-provider demo; capture results in the runbook.
- [ ] Commit `test: verify Kian first-release journey`.

## Handoff

Review this plan and the approved spec before creating the repository. The plan names proposed files and interfaces, while provider API details and exact supported dependency versions are verified at execution. Production launch requires the verified staging journey, privacy/retention decisions, and explicit release approval.
