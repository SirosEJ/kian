# Saved Kian handoff

Source, specification, implementation plan, progress and runbooks are tracked in this public repository. Jira epic SFT-225 is https://sepenta.atlassian.net/browse/SFT-225. Tasks 1–7 and Task 8 automated release preparation are implemented. The live release gate remains open.

To resume: configure the services in `.env.example` using a separate Firebase project and staging database, run `pnpm db:migrate`, and follow `docs/demo-runbook.md`. Record actual provider links/receipts only after live checks pass. Do not resend uncertain email tasks. Teams, WhatsApp and Zoom are subsequent integrations.

The task worker requires continuous runtime CPU. Keep the encryption key stable. For clean checkout verification, use Node 24, pnpm 11.25.0 and the committed lockfile.
