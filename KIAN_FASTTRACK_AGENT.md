# Kian FastTrack Developer Agent

Operating instructions for delivering Jira stories in the Sepenta FastTrack project (`SFT`) on this repository (`SirosEJ/kian`). Derived from `SEPENTA_FASTTRACK_AGENT.md` in `estate-voice-ai`; the Sepenta process is authoritative.

## Command

`Do SFT-N` runs the full pre-acceptance workflow below. Other commands: `Reject SFT-N: <reason>`, `Approve SFT-N`. Never infer approval.

## Required access

Authorised Sepenta Jira (Atlassian connector, site `sepenta.atlassian.net`), GitHub (`gh` authenticated) and GitHub Actions logs. If access is missing, stop and say exactly which. Never request, print or commit secrets. Never invent Jira data, test results, CI status, deployments or URLs.

## Do SFT-N workflow

1. Read the Jira story: title, description, acceptance criteria, dependencies, comments, status. If a material requirement is ambiguous, ask one focused question before coding.
2. Start from current `main`; inspect relevant code, tests and docs (`docs/superpowers/specs`, `docs/operations.md`).
3. Move Jira to `In Development` if a transition is available.
4. Branch `SFT-N-<short-slug>`.
5. Implement the smallest maintainable change satisfying the acceptance criteria, test first where practical. Keep to the Kian global constraints: per-user data isolation, no provider write without approval or a matching trust rule, no secrets in logs, no automatic resend of uncertain email.
6. Run locally: `pnpm install --frozen-lockfile && pnpm test && pnpm test:e2e && pnpm typecheck && pnpm build`.
7. Commit with the Jira key (`SFT-N: ...`) and push the branch.
8. Observe the `Test and Deploy Story Preview` workflow (`gh run watch`). It runs the full suite, then deploys Cloud Run service `kian-sft-N` (own database `kian_sft_N`) and checks `/health`.
9. On failure, read the logs, diagnose, fix on the same branch, push, observe again. Never report success while a run is queued, running, failed, skipped or cancelled.
10. When tests, deployment and health all pass, move Jira to `Awaiting Approval` if permitted and report:

`SFT-N is ready for acceptance.` with preview URL, test status, health status, acceptance checks from the story, and known limitations (including which providers are not live-connected in the preview).

## Rejection

Record the reason in Jira, move to `Rejected / Rework` then `In Development`, keep the same branch and preview service, fix, add tests, push, re-verify, and return for acceptance. Never merge a rejected story.

## Approval and production

`Approve SFT-N` is a human decision. Merge via pull request only after it. There is no production workflow yet; do not create one or deploy a story branch to a permanent production service without explicit instruction. Done = human accepted + merged + production deployed + production health verified.

## Boundaries

Do not change cloud IAM, Workload Identity Federation, secrets, billing resources or CI/CD architecture in an ordinary story unless the story explicitly authorises infrastructure work. Do not weaken tests to pass a build. Keep changes scoped to the story. Finish active stories before starting new ones.
