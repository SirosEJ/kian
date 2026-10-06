# Kian live demo and failure test: production script (SFT-232)

Run on **https://kian.sepenta.io/** with two real accounts. Everything here is safe to repeat; each step says what to type, what you must see, and what to write down. Record results in `docs/live-evidence.md` (section SFT-232): date, commit, what you saw, a link or screenshot name, your initials. Do not paste secrets into screenshots.

Use recognisable titles that start with `DEMO` so the objects are easy to find and delete afterwards.

## Before you start

| What | Who | Notes |
| --- | --- | --- |
| Account A | You (owner) | Signed in, Google Calendar and Jira connected in Settings, project and calendar chosen |
| Account B | A second person or a second email address you control | Fresh sign-up on production (never signed in before), nothing connected |
| Two browsers | Normal window for A, a private window (or another browser) for B | So the two sessions never mix |
| Optional | IONOS mailbox connected for A, and a recipient address you control | Only for the email steps |

Release being tested: commit `30e4d08`, revision `kian-prod-00005-mpt` (check the Jira story or `/health` if unsure).

## Part 1: the happy path (account A)

| # | Do | You must see | Write down |
| --- | --- | --- | --- |
| 1.1 | Type: `Book a meeting called DEMO planning tomorrow at 10:00 for 30 minutes` | One card "Create calendar event" with the title, tomorrow's date and time, and your time zone. **Nothing is in Google Calendar yet.** | Check your calendar: still empty |
| 1.2 | Press **Approve** | The card says approved and then succeeded. Open **Activity**: an entry with a link. The event is in Google Calendar at 10:00 for 30 minutes | Event link |
| 1.3 | Type: `Create a Jira story called DEMO delete me, description: demo of Kian` | One card "Create Jira issue" naming your Jira site and project. Nothing in Jira yet | |
| 1.4 | Press **Edit**, change the title to `DEMO story edited`, **Save**, then **Approve** | The issue exists in Jira with the edited title; Activity shows its link | Issue key |
| 1.5 | Type: `Book a meeting called DEMO reject me tomorrow at 15:00` then press **Reject** | The card shows rejected. Nothing appears in your calendar | |
| 1.6 | (Optional) `Email <your other address> with subject DEMO and say this is a Kian demo` | A card with the exact recipient, subject and body. Approve; the message arrives | Message ID from Activity |
| 1.7 | Hold the microphone button, say `Book a meeting called DEMO voice tomorrow at 11:00`, stop, **correct a word** in the box, send | The text appears while you speak, you can edit it, the card matches what you sent. Approve or reject | |
| 1.8 | Settings, **Keyboard**: turn "Press Enter to send my message" off. Back on Home type two lines with Enter, then press **Ctrl+Enter** (or the Send button) | Enter adds a line, Ctrl+Enter sends one message; turn it back on and Enter sends again, with no reload |

## Part 2: questions and changes to existing things (account A)

| # | Do | You must see |
| --- | --- | --- |
| 2.1 | `What is on my calendar tomorrow?` | A table with the DEMO events, times in your time zone |
| 2.2 | `Am I free on Friday afternoon?` | Free and busy time for that Friday; the dates are right |
| 2.3 | `Move DEMO planning to 11:00` (say it right after 2.1 so Kian has shown the event) | A card with a **What will change** table: time now and after. Approve and check Google |
| 2.4 | `Show me the stories I created today` then `change DEMO story edited to In Progress` | A card "Move SFT-N from X to Y" with the status before and after. Approve and check Jira |
| 2.5 | `There is a booking called DEMO planning tomorrow, delete it` | Kian finds it, names it and its time, and asks before preparing the delete. Say `yes`: a Delete card with no "always do this" box. **Reject** first (event stays), then ask again and approve (event is gone) |
| 2.6 | `Who are you Kian?` then `yes` | Kian introduces himself and shows the photos |

## Part 3: trusted actions and revoking them (account A)

| # | Do | You must see |
| --- | --- | --- |
| 3.1 | Ask for `Book a meeting called DEMO trusted tomorrow at 16:00`. On the card tick **Always do this without asking** and approve | Event created |
| 3.2 | Ask again for `Book a meeting called DEMO trusted two tomorrow at 17:00` | **No approval needed**: it runs by itself and Activity says "started automatically because it matches a trusted action" |
| 3.3 | Ask for the same kind of meeting in a **different calendar** (Edit the card and change the calendar) | The card needs your approval again: trust only covers the exact calendar |
| 3.4 | Settings, Trusted actions, **Revoke** | The rule shows revoked |
| 3.5 | Ask for another `DEMO trusted three` meeting | It needs approval again |
| 3.6 | Try to tick "always do this" on a status change or an event update or delete | It is not offered: those always need approval |

## Part 4: account isolation (accounts A and B)

| # | Do | You must see |
| --- | --- | --- |
| 4.1 | In B's window sign up a fresh account on production | B lands on an empty chat; Settings shows no connections, no trusted actions, no remembered names |
| 4.2 | B types `What is on my calendar tomorrow?` | Kian says Google Calendar is not connected and points to Settings. B sees none of A's events |
| 4.3 | B types `show me the stories assigned to me` | Kian says Jira is not connected |
| 4.4 | B opens **History** and **Activity** | Nothing from A |
| 4.5 | B asks `Who are you Kian?` and `yes` | Works: the photos are shown to any signed-in user (by design) |
| 4.6 | Signed out, open `https://kian.sepenta.io/persona/photos/kian-1` | Refused (401), no image |
| 4.7 | Copy A's task link from Activity and open it in B's window | Not found or refused; nothing of A's is shown |

## Part 5: failure cases (account A)

| # | Case | Do | You must see |
| --- | --- | --- | --- |
| F1 | Expired or revoked authorization | In your Google account: Security, Your connections to third-party apps, **Kian**, Remove access. Then ask `What is on my calendar tomorrow?` | A plain note that Google access expired and to reconnect in Settings; no crash, nothing marked done. Ask for a meeting and approve: the task fails visibly in Activity, no event. Reconnect in Settings and ask again: it works |
| F2 | Missing permission | `Move OPS-1 to Done` (any issue in a project other than the one chosen in Settings) | A card that cannot be approved, naming the project selected in Settings. Nothing changes in Jira |
| F3 | Ambiguous data | `Set up a meeting with Sam` | One question (what day and time?). If a card appears it shows an open question and **Approve is disabled** until it is answered |
| F4 | Partial success | `Book a meeting called DEMO partial tomorrow at 12:00 and move SFT-999999 to Done` then **Approve all** | Two cards. The meeting is created; the status change is refused (Jira cannot find the issue) and is not run. Activity shows each outcome separately and the meeting is not undone |
| F5 | A group request | `show me the stories assigned to me in Deployed` then `how many are there` | The count matches the table (it comes from a lookup) |
| F6 | Not looked up, not claimed | `Delete the Jira issue SFT-12` | Kian says it cannot delete Jira issues; it does not say it is preparing anything |

**Not provoked live, backed by automated tests:** a provider timeout, an email interrupted after the provider accepted it, and a restart in the middle of a send. These are covered by `apps/api/src/modules/execution/runner.test.ts` and `apps/api/tests/e2e/kian-journey.spec.ts` (an uncertain email is never retried automatically). Do not try them on production.

## Part 6: clean up

Delete the DEMO calendar events and close the DEMO Jira issue. In Settings, revoke any trusted action and disconnect B's test connections if any. B can delete the test account under Settings, Account (type `DELETE`). Keep your evidence until the agreed retention period ends.

## What the demo status means

The demo is **accepted** when Part 1 to 5 are recorded as passed (F4 and the automated-only cases noted as such). Any failed row stays "failed" with a short note and becomes a story; nothing is marked passed that was not seen.
