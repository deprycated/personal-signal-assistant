# Project Plan — Personal Signal Assistant MVP

## Product goal

Natural-language personal assistant available only through Signal. No commands, prefixes or special syntax. The first useful product should cover capture, reminders, calendar, recall, checkpoint/resume and a constrained `co teraz?` flow.

## Architectural principles

1. **Natural language first** — authorized messages are interpreted by a model when deterministic transport shortcuts do not apply.
2. **Auth before AI** — unauthorized Signal payloads never reach OpenRouter or tools.
3. **LLM proposes, application decides** — native tool calls + Zod + default-deny policy.
4. **No generic SQL tool** — the model only sees narrow application capabilities such as `reminder_schedule`.
5. **Deterministic execution** — persistence, retries, scheduling and permissions remain application code.
6. **Bounded model work** — per-message tool loops are hard-capped; no autonomous background agent loops in MVP.
7. **Small blast radius** — one owner, direct messages only, minimal external scopes, no shell/SSH/Docker socket.
8. **Capture before organization** — ideas are not automatically tasks or projects.
9. **SQLite for operational state; Markdown/Git for durable knowledge.**
10. **Simple conversational context** — send the active conversation history to the model; a new conversation starts after 24 hours of inactivity. Tool calls and tool results are part of that history.

## Milestones

### M0 — Signal transport
Deliver a secure and observable Signal transport layer.

Acceptance:
- owner `ping` → `pong`;
- foreign sender → silent drop;
- group message → drop;
- reconnect after Signal API restart;
- no message body in unauthorized logs.

### M1 — OpenRouter natural-language layer
Add one inexpensive model for authorized natural-language input.

Acceptance:
- typo-tolerant input such as `jtro 17 dentsta`;
- missing critical information is not invented;
- model output is locally validated before it can affect application state;
- model/provider errors fail closed with a short user-facing error.

### M2 — tool runtime, persistence and reminders
SQLite + Drizzle + bounded native tool calling + scheduler.

Acceptance:
- model has narrow tools, never generic SQL/database access;
- tool arguments are Zod-validated and policy-authorized;
- the complete active conversation is available to the model, including assistant replies, tool calls and tool results;
- more than 24 hours of inactivity starts a fresh conversation context;
- context sent to the model is capped to the most recent 100 messages;
- `Lekarz jutro o` → question for time, then `13` continues the same conversation naturally;
- `a jednak 16:30` can update a reminder using the real id from prior tool history rather than an application-side pending-action state machine;
- reminders survive restart;
- event time and notification time are distinct; event reminders default to 30 minutes before;
- duplicate processing of the same Signal message/tool index does not create a duplicate reminder;
- failed delivery is retried with bounded exponential backoff;
- stale delivery claims are recovered after restart;
- audit trail contains decisions/IDs/timestamps, not secrets;
- the external Signal boundary is documented as not strictly exactly-once across a crash between remote send and local commit.

### M3 — Notes and recall
Inbox, durable Markdown and search.

Planned tools:
- `note_create`
- `note_search`

Acceptance:
- one-message capture;
- original captured content remains recoverable;
- search returns relevant prior notes;
- Git sync is asynchronous/periodic rather than a commit per Signal message.

### M4 — Google Calendar
Read + create only for MVP.

Planned tools:
- `calendar_list`
- `calendar_create`

Acceptance:
- calendar data can answer `co mam jutro?`;
- creation requires complete date/time semantics;
- delete remains denied.

### M5 — Context assistance
Checkpoint/resume and `co teraz?`.

Planned tools:
- `checkpoint_save`
- `checkpoint_load`
- `plan_get_next`

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
- generic SQL tool
- destructive calendar/reminder/file operations
- shell/SSH/Docker access
