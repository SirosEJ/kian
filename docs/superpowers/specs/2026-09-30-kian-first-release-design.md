# Kian: first-release product design

Date: 30 September 2026  
Status: design approved in conversation; written specification for review

## Purpose and outcome

Kian is a standalone web app for anyone who wants a personal organiser that acts on spoken or typed instructions. A user creates an account, connects the services they use, submits an instruction, reviews the exact proposed actions, and confirms each action. They can explicitly trust a narrowly defined action for future automatic execution and revoke that trust at any time.

The first release must work with a calendar, Jira Cloud, and email. The first Sepenta demonstration uses Google Calendar, Sepenta's IONOS email mailbox, and Jira Cloud. Kian is a separate product from Sepenta Business Discovery and Delivery Console, though its integration patterns may be shared later if doing so does not couple their user data or release cycles.

## Scope

### Included in the first release

- Self-service account creation and sign-in; each user's instructions, connections, trust rules, and activity are isolated.
- Responsive web interface for typed input and browser-recorded voice. Users can inspect and correct a transcript before task planning.
- Parsing of one instruction into one or more proposed tasks. Each task displays its action, account, destination, content, timing, and any assumptions.
- Review screen to edit, approve, or reject tasks individually. No external write occurs while a task is merely proposed.
- Optional “Trust and automate this task in future” choice during approval. A trust rule is scoped to a provider connection, action type, and explicit constraints; it is never a blanket permission for all tasks. The user can view and revoke rules in Settings.
- Guided Settings for Google Calendar, Jira Cloud, and an IONOS mailbox, with connection tests, status, reconnect, and disconnect controls. Additional provider implementations can use the same connector contract later.
- Calendar event creation and update, Jira issue creation and update in accessible projects, and email drafting/sending, subject to the confirmation rule. The exact supported fields are described by the connector during task review.
- Activity history showing the submitted instruction, transcript if applicable, proposed and edited actions, approval or trust-rule basis, execution result, timestamps, and provider object links where available.

### Later, after provider feasibility and user demand

Microsoft Teams, WhatsApp, Zoom, other messaging/meeting services, additional calendar and mailbox providers, recurring autonomous agents, and shared team administration. Kian's first-release design must not promise that consumer accounts expose APIs for direct integration.

## User journeys

1. **Create an account:** A new user signs up, confirms their account, and reaches an empty dashboard that explains how to connect services.
2. **Connect a service:** In Settings, the user chooses a provider, follows its supported authorization or credential flow, tests access, and selects the relevant calendar, Jira site/project, or mailbox. Secrets are not displayed after saving.
3. **Submit an instruction:** The user types text or records audio in the browser. Kian transcribes audio and lets the user correct it. Kian produces a plan of discrete actions, with unclear names, dates, time zones, recipients, or destinations flagged for clarification.
4. **Review:** The user inspects exact recipients and email text, event details, or Jira fields. They edit, approve, or reject each task. A multi-action instruction does not receive a single blanket approval.
5. **Execute:** Kian validates the current connection and permissions and executes approved actions once. It reports each outcome independently and links to the created or updated object.
6. **Trust:** During approval, the user may save a rule for the same action class and a specified connection and constraints. Future matching tasks can execute automatically only if the rule remains active and the target details fit. Ambiguous or materially changed details return to review.
7. **Audit and revoke:** The user sees the action history and can disable a connection or trust rule. Disabling a connection blocks further calls using it.

## Architecture and responsibilities

- **Web client:** authentication, recording and transcript correction, task review, Settings, and activity history. It never receives provider secrets for persistent storage.
- **Application API:** verifies user identity and ownership, stores instructions and task state, enforces state transitions, and issues execution requests. Every query and mutation is scoped to the authenticated user.
- **Speech and planning service:** transcribes audio, interprets instructions into a typed task schema, and reports uncertainty. Model output is treated as a proposal, not authorization. Unsupported actions receive an explanation rather than a fabricated result.
- **Policy and approval service:** matches a task against narrowly scoped, versioned trust rules, checks missing information, records user approval, and decides whether execution is allowed. Trust is checked again immediately before execution.
- **Connector interface:** each provider implements connect, test, discover permitted destinations, validate task, execute, and disconnect. Google Calendar, Jira Cloud, and IONOS mail are the initial adapters. Provider-specific limitations stay within adapters.
- **Execution worker:** takes a permitted task, applies idempotency protection, makes the provider call, records the outcome, and handles retries without duplicate emails, events, or issues.
- **Storage:** user profiles; encrypted connection references and required secrets; submitted inputs; proposed task versions; approvals; trust rules; immutable action results. Raw audio retention is minimized and user controlled.

## Data and security rules

- User A must never access user B's instructions, provider connections, trust rules, or activity, including by changing an API identifier.
- Use provider authorization where available. For the IONOS mailbox, document the supported mail access method and its requirements during implementation planning; store any required credential securely and allow rotation. Do not ask users to place mailbox passwords in chat or an instruction.
- Keep the least access needed for the selected actions. Clearly explain requested permissions at connection time. Revoking a provider connection or trust rule must stop future execution.
- Treat transcripts and message text as untrusted input. Content from an email, calendar event, or Jira issue cannot grant itself permission to act.
- A trust rule must identify the exact owner, connection, action, and constraints. Sending email to a new recipient, changing a different project/calendar, destructive edits, or a task with low confidence requires explicit review even if a similar rule exists.
- Log the action and outcome without unnecessarily retaining provider tokens or sensitive message bodies in operational logs. Provide account data deletion and retention controls before public launch.

## Errors and recovery

- Expired or revoked authorization: pause the task and offer reconnect; never mark it complete.
- Unclear instruction: ask a focused clarification and keep the task in draft.
- Missing permission or destination: explain the specific project, calendar, or mailbox issue and offer a valid selection.
- Partial success in a multi-task instruction: show completed and failed tasks separately. Do not silently rerun a successful task.
- Provider timeout or retry: use a task idempotency key and confirm provider state before any retry that could create a duplicate.
- Recording or transcription failure: preserve the user's typed text or upload state when possible, and allow retry.

## Verification and release criteria

- A fresh user can sign up, connect the three required services, give a voice or typed instruction, review each proposed task, approve it, and see the real provider result.
- Exercise calendar create/update, Jira create/update, and email draft/send with valid and invalid input. Verify recipient identity, time zone, project key, fields, and resulting links.
- Reject, edit, and approve individual tasks from a multi-task instruction; verify no rejected task writes externally.
- Create a constrained trust rule, execute a matching action automatically, reject a nonmatching action for review, revoke the rule, and verify that future actions require confirmation.
- Test account isolation, forged identifiers, expired connections, permission denial, ambiguous names and dates, network failures, and safe retries.
- Show a truthful demo status for each connector. A fallback recording can support a presentation, but is not evidence that a failing live integration works.

## Open implementation decisions for the plan

- Select the hosting stack, authentication provider, speech service, datastore, and deployment environment after checking the available Sepenta repositories and operational preferences.
- Validate the exact IONOS mailbox access method and whether the demonstration mailbox can safely grant send and draft permissions.
- Define the first supported Jira issue fields and Google Calendar event fields from an actual test account, rather than assuming every tenant has identical custom fields.
- Set a retention period for raw audio and stored instruction content before inviting public users.

## Relationship to current Sepenta backlog

SFT-217 covers a Jira connection wizard inside Business Discovery. SFT-224 covers communication evidence in Business Discovery. Kian is a separate multi-user product and must have its own epic and implementation stories; those items are references, not dependencies on shared customer data.
