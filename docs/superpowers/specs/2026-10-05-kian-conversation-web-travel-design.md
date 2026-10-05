# Kian conversation, web research and travel service design

Date: 2026-10-05
Status: proposed for user review
Base: SirosEJ/kian main at f0e90441d316bce5153d1d4461b2da58e2588534

## Purpose

Kian should feel like a capable conversational personal organiser. A user can type or dictate a request, discuss it over multiple turns, ask Kian to research current information or connected services, and review each proposed action. The first service expansion covers public web research and searching travel tickets. Other services should fit the same controlled pattern.

Success means Kian can handle a natural follow-up or correction, answer from fresh and attributable evidence, compare real travel options where an enabled provider supplies them, and prepare useful tasks without silently sending, booking, paying or changing a connected account.

## Existing system and constraints

The web dashboard already supports threaded chat and action cards. The API stores owner-scoped messages, supplies the latest 20 messages to a forced-JSON planner and has an upper limit of 200 messages per thread. Jira and Google Calendar have bounded read-only lookups. Memory stores user-scoped names, aliases and dictation corrections, with an enable switch and deletion controls. The planner validates proposed email, calendar and Jira changes before they become cards; a separate task workflow handles approvals, trust rules and execution.

The new conversation layer must preserve tenant isolation, connection credentials kept outside model context, task version checks, existing approval rules and durable execution. It must not let a web page, search snippet or provider description supply instructions or permission. Voice transcription must feed the same conversation path as typed messages.

## Architecture

Introduce a small conversation orchestrator behind the existing instruction endpoint. It accepts an owner, conversation, current input, recent history, a compact summary and selected memory hints. It classifies the turn into three intents:

1. Conversation: ordinary discussion, clarification, comparison or advice. Generate a natural response without requiring an empty task list or action-shaped JSON.
2. Research: ask a narrow allow-listed read tool for current facts. Pass the observations back as untrusted, time-stamped evidence with source links; then generate an answer grounded in those observations.
3. Action: use the existing proposal planner and validation path. A mixed turn may answer and propose tasks, but all write effects still become versioned approval cards. A research step may inform a later proposal; retrieved text never authorizes an action.

The orchestrator may make at most two read rounds, three read calls per round and a finite observation budget per user turn. It should only call tools that the signed-in owner is authorized to use. No arbitrary browsing sessions, shell commands, arbitrary MCP tools or direct provider writes are exposed to the model. The orchestrator returns reply, citations, optional comparison data and validated task proposals through one typed result. Existing database writes and task state changes remain in the conversation service transaction.

## Conversation and memory

Keep recent exact turns and the existing memory terms. Before the older part of a thread falls outside the 20-message window, create an owner-scoped compact summary containing stable user goals, stated preferences, unresolved questions and decisions, with source message ranges and an updated-at time. The summary is context, never a source of permission. Recompute or invalidate it when an edited/deleted message would change its evidence. Keep bounded size and retain the original messages for history within the current retention policy.

Retrieval combines the current and previous user turn, the summary and the existing relevant-term store. User edits and corrections should supersede guesses. The memory setting continues to disable learning and retrieval; users can inspect and clear learned terms. Add a way to inspect and clear summaries for a conversation. Do not infer sensitive traits or store payment details, passwords or secrets in summaries or term memory.

A conversation-only turn must never replace pending action cards unless the user explicitly cancels or corrects those actions. The replacement decision remains explicit and validated. Keep the current reply and cards visible together in the UI.

## Web research

Provide server-side public search through a configured search provider. A read adapter accepts a short query, returns a small set of results with title, canonical URL, snippet, retrieval time and provider status, and may fetch an allow-listed public result for verification. Reject private and local network addresses, redirects to them, oversized responses, unsupported content types and pages needing login. Apply timeouts and per-user cost/rate limits. Strip markup and instructions from page content before passing quoted evidence to the answer model. The model cannot invent sources or claim a live check when the adapter failed.

In the UI, show linked sources and when the search was run. Separate current evidence from Kian's inference. If sources disagree or look stale, say so and offer to narrow the search. Jira or calendar questions continue to use their connected read adapters and actual returned records, never public search as a substitute for private account data.

## Travel search and booking

A travel-search adapter is a provider contract, not a generic web scraper. First integration focuses on flight-ticket search with departure and arrival places, local dates, passenger count and optional baggage or timing preferences. It returns provider name, itinerary legs, currency, displayed price, fare conditions where available, quote timestamp, expiry if provided and a direct provider link. Show the search assumptions and let the user refine them in chat. Search results are informational; live price and seat availability must be rechecked at handoff.

If a supported provider offers a booking API, Kian can prepare an exact booking proposal with itinerary, passengers, full price and terms. A server-side check immediately before checkout must refresh price, availability and passenger details. A changed price or itinerary invalidates earlier approval. Final payment and purchase require fresh, explicit confirmation for that transaction; no trust-and-automate rule can apply to money movement or final purchase. Until a supported provider and payment flow exist, Kian only offers a provider link and says that the user completes checkout there. It never claims a booking was made from a search result.

Use the same read/proposal/approval contract for later services such as rail, hotels and reservations. Each adapter needs its own capability, account scope, provider error handling and action-specific confirmation policy. No generic provider URL or credential field grants an arbitrary website access.

## Interface, failure and operations

The chat UI displays normal conversational answers, source cards with dates, travel comparison cards and existing approval cards. During a lookup show a short activity state. On timeout or provider outage, retain the user's message, report the limitation and avoid fabricated answers. A retry must not duplicate an action. All observations and proposals are scoped by owner; record tool type, status and count in activity logs without storing credentials or full private payloads. Make source retrieval and model cost measurable, with per-turn bounds.

The Settings area lists enabled web and travel search capabilities and connected provider accounts. Public search does not require a user's account if the application has a provider configured. Any authenticated travel service requires the user's own authorization and a clear disconnect control.

## Delivery slices and acceptance checks

1. Conversation routing: natural chat and corrections, compact history summary, owner-scoped retrieval. Existing approval paths continue to pass regression tests.
2. Web research: configured public search, linked and dated evidence, safe fetch, failure handling and limits. A missing search provider is shown as unavailable.
3. Flight search: one supported, documented provider; real structured itineraries and terms, refinement and comparison. If no provider integration is configured, show a clear unavailable state rather than example fares.
4. Purchase capability: only after a provider supports it, with fresh quote, explicit final confirmation, audit event and no automated purchase trust. This slice is not a prerequisite for useful flight search.

Automated tests cover follow-up references beyond the recent window, corrections and exclusions, conversation-only turns preserving pending cards, injected page instructions being ignored, source attribution, read bounds and failures, tenant isolation, date/time-zone handling, stale fare/price changes, and every path to a write retaining the existing per-task approval. Evaluate a small fixed set of real Kian-style transcripts before and after the change for answer quality, task correctness and latency. Run existing API, web, typecheck and build gates. Live provider search and checkout need a controlled sandbox or demo account before any public claim.

## Out of scope for this spec

Do not copy ScallopBot's single-process runtime, autonomous gardener, broad skill execution or proactive outreach into Kian. Do not add arbitrary website login, scraping of booking checkouts, generic payments, or automatic purchase. Channel integrations such as Teams, WhatsApp and Zoom remain separate work and can reuse the eventual conversation interface.
