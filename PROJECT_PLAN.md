# Project Plan — Personal Signal Assistant MVP

## Product goal

Natural-language personal assistant available only through Signal. No commands, prefixes or special syntax. The first useful product should cover capture, reminders, calendar, recall, checkpoint/resume and a constrained `co teraz?` flow.

## Architectural principles

1. **Natural language first** — every authorized message may go to the intent model once OpenRouter is added.
2. **Auth before AI** — unauthorized Signal payloads never reach OpenRouter or tools.
3. **LLM proposes, application decides** — structured outputs + Zod + policy engine.
4. **Deterministic execution** — reminders, scheduler, persistence and permissions remain application code.
5. **Small blast radius** — one owner, direct messages only, minimal external scopes, no shell/SSH/Docker socket.
6. **Capture before organization** — ideas are not automatically tasks or projects.
7. **SQLite for operational state; Markdown/Git for durable knowledge.**
8. **No autonomous loops in MVP.**

## Milestones

### M0 — Signal transport
Deliver a secure and observable Signal transport layer.

Acceptance:
- owner `ping` → `pong`;
- foreign sender → silent drop;
- group message → drop;
- reconnect after Signal API restart;
- no message body in unauthorized logs.

### M1 — OpenRouter structured intent
Add one cheap model for all authorized natural-language input.

Acceptance:
- strict schema validated locally;
- typo-tolerant input such as `jtro 17 dentsta`;
- ambiguity is represented explicitly;
- missing critical information results in one focused follow-up question;
- contextual follow-up such as `a jednak 16:30` modifies the correct pending context.

### M2 — Persistence and reminders
SQLite + Drizzle + scheduler.

Acceptance:
- reminders survive restart;
- due reminders are delivered once;
- create/update are idempotent enough to tolerate retry;
- audit trail contains decisions, not secrets.

### M3 — Notes and recall
Inbox, durable Markdown and search.

Acceptance:
- one-message capture;
- original captured content remains recoverable;
- search returns relevant prior notes;
- Git sync is asynchronous/periodic rather than a commit per Signal message.

### M4 — Google Calendar
Read + create only for MVP.

Acceptance:
- calendar data can answer `co mam jutro?`;
- creation requires complete date/time semantics;
- delete remains denied.

### M5 — Context assistance
Checkpoint/resume and `co teraz?`.

Acceptance:
- checkpoint records current focus, done, next and open questions;
- resume returns concise context;
- `co teraz?` returns at most 1–3 grounded options and does not fabricate backlog data.

## Explicitly out of MVP

- Gmail
- web search
- RAG/vector DB/embeddings
- MCP ecosystem
- multi-user
- admin UI
- autonomous agent loops
- destructive calendar or file operations
- shell/SSH/Docker access
