# Live evidence

Record only checks that actually passed, with date, commit, browser, URL, operator initials and the provider receipt or link. Never paste passwords, tokens or full message bodies.

## SFT-236: IONOS email

| Check | Result | Evidence |
| --- | --- | --- |
| Mailbox connect with valid credentials | passed | 2026-09-30, Chrome, https://kian-sft-236-ayligdccta-ew.a.run.app, smtp.ionos.co.uk, SJ |
| Wrong password shows an auth-specific message | pending | |
| Test connection reports connected | pending | |
| Update password verifies before saving | pending | |
| Typed instruction proposes exact recipients, subject, body | passed | 2026-09-30, SJ: recipient, subject and message shown for review |
| Approved send reaches controlled recipient (Message-ID) | passed, landed in Gmail Spam | 2026-09-30 22:49 and 22:50, SJ. Sent with the earlier @kian.local Message-ID; Message-ID value not yet recorded |
| Activity shows Message-ID and result | pending | |
| Second account cannot see or use this mailbox | pending | |

Notes: SMTP acceptance is not proof of delivery. The two test messages were delivered to Spam, not Inbox. Message-ID now uses the mailbox domain; whether that changes placement is unverified. Sender-domain SPF, DKIM and DMARC for sepenta.io are configured outside Kian and are unchecked.

## SFT-228: approvals, trusted actions and audit trail

Use any provider that is connected; email on a preview or staging works without OAuth. Use a controlled recipient you own (call it A) and a second address you own (call it B).

| Check | Result | Evidence |
| --- | --- | --- |
| Instruction to email A creates a proposal; nothing is sent before Approve | pending | |
| Edit the proposal, then Approve: the edited text is what is sent | pending | |
| Reject a second proposal: nothing is sent; Activity says "Rejected by you" | pending | |
| Approve with the trust box ticked; the box text names A and the mailbox | pending | |
| Settings lists the trusted action naming the mailbox and A, with Revoke | pending | |
| Second instruction to A runs by itself; Activity says "Started automatically because it matches a trusted action" | pending | |
| Instruction to B (a new recipient) waits for approval | pending | |
| Revoke the rule; the next instruction to A waits for approval again | pending | |
| An update to an existing item shows no trust option | pending | |
| Activity shows the Message-ID and result for each sent email | pending | |
| A second account sees none of these tasks, rules or activity | pending | |

