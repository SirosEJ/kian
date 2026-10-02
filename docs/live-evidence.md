# Live evidence

Record only checks that actually passed, with date, commit, browser, URL, operator initials and the provider receipt or link. Never paste passwords, tokens or full message bodies.

## SFT-236: IONOS email

| Check | Result | Evidence |
| --- | --- | --- |
| Mailbox connect with valid credentials | passed | 2026-09-30, Chrome, https://kian-sft-236-ayligdccta-ew.a.run.app, smtp.ionos.co.uk, SJ |
| Wrong password shows an auth-specific message | pending | |
| Test connection reports connected | passed | 2026-10-01 13:30, Chrome, SFT-228 preview (mailbox saved after the submit-button fix), SJ |
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

## SFT-227: voice and text intake with Kian's reply

Use the real planning model on a preview or staging.

| Check | Result | Evidence |
| --- | --- | --- |
| Type "Email <A> that the meeting is moved to Friday": Kian replies in words, proposes one email with a subject it wrote | pending | |
| Type "Book me a flight to Rome": Kian explains it cannot, lists what it can do, and creates no task | pending | |
| Type "Meeting with Sam on Friday": Kian asks for the exact time (or the proposal is flagged) instead of guessing | pending | |
| Type two actions in one sentence: two separate task cards, each with its own account, destination and details | pending | |
| Dictate (Chrome) the same text: identical reply and cards to typing | pending | |
| Task cards show "Using <mailbox name>" | pending | |
| Dictation in Safari | pending | |

## SFT-253: conversational assistant

Use the real planning model on the story preview. Model: `KIAN_PLANNING_MODEL` is a comma separated list tried in order (default `gpt-4.1,gpt-4o`); record which model answered if you change it.

| Check | Result | Evidence |
| --- | --- | --- |
| "Hi, what can you do?": a warm answer listing calendar, Jira and email, no tasks | pending | |
| "Set up a meeting with Sam": Kian asks one question (day/time); reply "Friday at 3pm": one proposal with the exact time, and no duplicate left behind | pending | |
| After that, "actually make it Saturday": the old card disappears from Home and shows as Replaced in Activity; one card remains | pending | |
| "Email <A> about lunch" then "send it to <B> instead": one email card to B only | pending | |
| "Forget it" cancels the undecided cards (Replaced in Activity) | pending | |
| "Which mailbox am I connected to?" is answered from the real connections; "what tasks are waiting?" matches Home | pending | |
| Approve a card, then say "change it": the approved task is untouched | pending | |
| Reload the page: the conversation is still there; New conversation clears it; the old one is not shown | pending | |
| Dictate (Chrome) a follow-up answer: it appears in the same thread | pending | |
| Phone width (390px): thread, prompt and cards readable, no sideways scrolling | pending | |
| A second account never sees this thread | pending | |
| Not included: the reply appears when complete (no word-by-word streaming) | n/a | |

## SFT-254: chat screen

Check on the preview, at desktop width and on a real phone (or 390px and 360px wide).

| Check | Result | Evidence |
| --- | --- | --- |
| Empty chat shows a welcome and four examples; tapping one sends it | pending | |
| The prompt box stays at the bottom while a long chat scrolls; the latest message is never hidden behind it | pending | |
| A task card appears under the reply that prepared it; Approve / Reject / Edit work there and update the card in place | pending | |
| Scroll up in a long chat, send a message: it jumps to the new message; receive a reply while scrolled up: "Jump to latest" appears | pending | |
| Phone: keyboard open keeps the prompt and latest message visible; no sideways scrolling; buttons easy to tap | pending | |
| History lists earlier conversations; choosing one opens it; New conversation starts a clean chat | pending | |
| Dictation fills the box and sending it shows the thread as before (Chrome) | pending | |
| A "Replaced" card is short and says it was never approved or run | pending | |

## SFT-237: production

Results to record when the owner prerequisites exist and the first release has run.

| Check | Result | Evidence |
| --- | --- | --- |
| Release gate refuses a commit that is not on main, or has no successful staging deploy (automated tests; also try once for real) | pending | |
| Run waits for reviewer approval in the `production` environment and does nothing before it | pending | |
| First release: tests pass, deploy succeeds, `/health` ok on the Cloud Run URL | pending | |
| `https://kian.sepenta.io/` loads over HTTPS | pending | |
| Sign-up and sign-in work on production; the account does not exist on staging (separate Firebase project) | pending | |
| A staging account cannot sign in on production, and data written on one never appears on the other | pending | |
| Rollback command (previous revision) works once | pending | |
| No secret values appear in the run log or summary | pending | |

## SFT-266: guests and missing connections

Use the real planning model on the preview.

| Check | Result | Evidence |
| --- | --- | --- |
| "Book a meeting with Sam", then "Saturday at 10 for 30 minutes": no question about inviting Sam, and the card can be approved (with a calendar connected) | pending | |
| Same without a calendar connected: the reply says it does not see a connected Google Calendar and points to Settings | pending | |
| "Book a meeting with Sam and invite sam@example.com": the invitation is kept | pending | |
| With two calendars connected: the reply asks you to choose with Edit | pending | |

## SFT-234: Google Calendar live on staging

Staging: https://kian-staging-1088794188480.europe-west1.run.app/ · Google account siros.jarchlou@gmail.com · OAuth client "Kian staging" (consent screen: External, In production, unverified, so Google shows its "hasn't verified this app" warning and caps use at 100 users) · 2 Oct 2026.

| Check | Result | Evidence |
| --- | --- | --- |
| Settings > Connect Google Calendar: Google consent, returns to Kian as connected | passed (2 Oct 2026) | Settings showed "Account connected." |
| Choose a calendar; connection shows its status | passed | Settings showed "Selected calendar: siros.jarchlou@gmail.com" with Choose calendar and Disconnect |
| "Book a meeting called Kian test tomorrow at 10:00 for 30 minutes" produces a reviewable proposal (title, date, time zone) with no unrequested guest question | passed | Card "Kian test", 2026-10-03 10:00 to 10:30 (+03:00, Europe/Istanbul), "Using Google Calendar"; Kian's reply had no invitee question |
| Approving it creates a real event | passed | Card state Done; the event "Kian test, 10:00" appeared in Google Calendar on Saturday 3 October (owner screenshot); owner deleted it afterwards |
| The event link appears in Activity | pending | |
| Reconnect works | pending | |
| Expired/revoked Google access pauses the task and offers reconnect; nothing marked complete | pending | |
| A second account sees none of this connection or these calendars | pending (covered by automated isolation tests) | |
| No tokens in logs | pending | |

The client secret was shown once in a screenshot during setup, so it was rotated: a new secret was created in Google, stored in Secret Manager (`kian-google-client-secret`), and the old one deleted before first use.

