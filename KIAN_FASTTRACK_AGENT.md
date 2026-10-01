# Kian FastTrack Developer Agent

Operating instructions for delivering Jira stories in the Sepenta FastTrack project (`SFT`) on this repository (`SirosEJ/kian`). Derived from `SEPENTA_FASTTRACK_AGENT.md` in `estate-voice-ai`; the Sepenta process is authoritative.

## Command

`Do SFT-N` runs the full pre-acceptance workflow below. Other commands: `Reject SFT-N: <reason>`, `Approve SFT-N`. Never infer approval.

## Required access

Authorised Sepenta Jira (Atlassian connector, site `sepenta.atlassian.net`), GitHub (`gh` authenticated) and GitHub Actions logs. If access is missing, stop and say exactly which. Never request, print or commit secrets. Never invent Jira data, test results, CI status, deployments or URLs.

## Jira statuses

The SFT project uses these statuses (all transitions are global; list them with `getTransitionsForJiraIssue` and use the returned ids, never guess):

| Status | Meaning in this workflow |
| --- | --- |
| To Do / Story Quality Check / Ready for Development / Business Review Needed | Backlog and refinement. Owned by the human; do not move stories out of these except to start work |
| In Progress | The agent is implementing, testing and fixing |
| Blocked | Cannot proceed: unresolved "is blocked by" link, missing credential, external prerequisite or pending human decision. Always add a comment naming the blocker |
| Peer Review | Pull request open, local checks, CI and the preview workflow all green; waiting for the human to review and accept |
| UAT | Merged and deployed to staging; waiting for live acceptance that needs real provider accounts (Google, Jira, IONOS) |
| Approved | Human accepted (`Approve SFT-N` or equivalent). Transition immediately before merging |
| Deployed | Merged to `main` and the staging deploy and health check passed. Production has its own, separate release (below); a story is not Done until it has been released there |
| Done | Human closes it after the story's commit is released to production (https://kian.sepenta.io/) and production health is verified. The agent never moves a story to Done |

## Do SFT-N workflow

1. Read the Jira story: title, description, acceptance criteria, dependencies, comments, status. If a material requirement is ambiguous, ask one focused question before coding.
2. Start from current `main`; inspect relevant code, tests and docs (`docs/superpowers/specs`, `docs/operations.md`).
3. Check the story's issue links. If any "is blocked by" story is not Deployed or Done, stop: move to Blocked with a comment, and report. Otherwise move Jira to `In Progress` and comment the branch name.
4. Branch `SFT-N-<short-slug>`.
5. Implement the smallest maintainable change satisfying the acceptance criteria, test first where practical. Keep to the Kian global constraints: per-user data isolation, no provider write without approval or a matching trust rule, no secrets in logs, no automatic resend of uncertain email.
6. Run locally: `pnpm install --frozen-lockfile && pnpm test && pnpm test:e2e && pnpm typecheck && pnpm build`.
7. Commit with the Jira key (`SFT-N: ...`) and push the branch.
8. Observe the `Test and Deploy Story Preview` workflow (`gh run watch`). It runs the full suite, then deploys Cloud Run service `kian-sft-N` (own Neon database branch `kian-sft-N`) and checks `/health`.
9. On failure, read the logs, diagnose, fix on the same branch, push, observe again. Never report success while a run is queued, running, failed, skipped or cancelled.
10. When local checks, CI, tests, deployment and health all pass, open a pull request to `main` (do not merge), move Jira to `Peer Review`, add a Jira comment with the PR link, preview URL and result summary, and report:

`SFT-N is ready for acceptance.` with preview URL, test status, health status, acceptance checks from the story, and known limitations (including which providers are not live-connected in the preview).

## Rejection

Record the reason in a Jira comment, move the story back to `In Progress`, keep the same branch, pull request and preview service, fix, add tests, push, re-verify, move to `Peer Review` again and report. Never merge a rejected story.

## Approval and production

`Approve SFT-N` (or an unambiguous "accept/approved" for that story) is a human decision. Then: move Jira to `Approved`, merge the pull request, watch the `Deploy Staging` run from `main` and check `/health`, and move Jira to `Deployed` with a comment. If the story needs live-provider acceptance on staging, move it to `UAT` instead and say exactly what the human must check.

### Releasing to production

Production is `kian-prod`, served at https://kian.sepenta.io/, released by `.github/workflows/production.yml` (details and owner prerequisites in `docs/operations.md`, section Production). It is a manual workflow that takes a commit SHA, and it only releases a commit that is on `main` and whose own `Deploy Staging` run succeeded. A GitHub reviewer must approve the run in the `production` environment before anything deploys.

- The agent releases only when the human says so explicitly (`Release SFT-N to production`, `Release <sha>` or similar), naming the story or commit. Approving a story is not approval to release it. Check the commit is the merge of that story (or later) and that staging is healthy first.
- Start it with `gh workflow run production.yml -f sha=<full 40-character sha>`, tell the human that a reviewer approval is waiting in the `production` environment, and watch it (`gh run watch`). Never approve the environment gate on the human's behalf.
- When the run succeeds and `/health` passes (the run summary also shows whether https://kian.sepenta.io/ answers), comment the commit, run link and previous revision on each included story. Stories stay `Deployed`; only the human sets `Done`.
- Roll back by sending traffic to the previous revision (command in the run summary and in `docs/operations.md`). Database migrations only move forward, so a release with a migration is rolled back by a fixed follow-up release, not by dropping tables.
- Never deploy a story branch or a preview to production, and never run production deploys from a laptop.

## Boundaries

Do not change cloud IAM, Workload Identity Federation, secrets, billing resources, DNS or CI/CD architecture in an ordinary story unless the story explicitly authorises infrastructure work. The production Firebase project, database, secrets, domain, GitHub `production` environment and OAuth apps are always owner actions. Do not weaken tests to pass a build. Keep changes scoped to the story. Finish active stories before starting new ones.

## Repository facts learned in practice

- Stable staging is `kian-staging`, deployed from `main` by `.github/workflows/staging.yml`; its URL `https://kian-staging-1088794188480.europe-west1.run.app/` is the only OAuth redirect URL for Google and Atlassian. Story previews (`kian-sft-N`) have changing URLs, so provider OAuth is tested on staging and everything else, including SMTP email, on previews.
- Web Firebase config reaches the Docker build through `firebase-public.env` written by the workflows; do not rely on `--set-build-env-vars`.
- Automated tests use PGlite, which hides pg-pool behaviour. When a change touches transactions or connections, verify on the preview against the real database, and read Cloud Run logs with `gcloud logging read` (request logs, never tokens or bodies).
- Record live-provider results only when they actually passed, in `docs/live-evidence.md`. SMTP acceptance is not delivery; say what the human observed.
- IAM, secrets and OAuth apps are owner actions. Give the exact command or steps and ask; do not change IAM without approval. Never read or print secret values.
