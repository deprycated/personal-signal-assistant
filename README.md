# Personal Signal Assistant — MVP

Self-hosted personal assistant with Signal as the only user interface. Natural language is the primary UX: no slash commands, prefixes or special syntax are required.

## Current architecture

```text
Signal
  ↓
owner auth gate
  ↓
load active conversation history
  ↓
OpenRouter / DeepSeek
  ↓ native tool calls
ToolRegistry → default-deny Policy → Zod → domain services
                                         ↓
                                  SQLite / Drizzle
                                         ↓
                              ReminderScheduler → Signal
```

The model never receives generic SQL/database access.

## Status

### M0 — Signal transport

- [x] Docker Compose + `signal-cli-rest-api`
- [x] Bun + TypeScript
- [x] WebSocket receive loop with reconnect/backoff
- [x] owner allowlist before application/LLM handling
- [x] Signal UUID/ACI support for sealed sender
- [x] group rejection
- [x] Signal replies through `/v2/send`
- [x] localhost-only published ports

### M1 — natural-language interpretation

- [x] OpenRouter integration
- [x] natural Polish input including typos and abbreviations
- [x] Zod runtime validation
- [x] bounded model execution

### M2 — tools, conversation history, SQLite and reminders

- [x] native OpenRouter `tools` / `tool_calls`
- [x] explicit `ToolRegistry` and default-deny policy
- [x] SQLite + Drizzle operational state
- [x] rolling conversation history with 24h inactivity boundary
- [x] persisted `user`, `assistant`, assistant `tool_calls` and `tool` result messages
- [x] context capped to the most recent 100 messages
- [x] reminder create/update/list tools
- [x] separate event time and notification time
- [x] event reminders default to 30 minutes before
- [x] deterministic `rano` / `po południu` / `wieczorem` handling
- [x] scheduler with retry/backoff and stale-claim recovery
- [x] idempotent reminder creation for repeated Signal message/tool call

Next: notes/recall, Google Calendar, checkpoint/resume and `co teraz?`.

## Conversation context

Context is deliberately simple. Each successful exchange is stored as the same message shapes OpenRouter uses:

```text
user
assistant
assistant tool_calls
optional tool results
assistant
```

For every new Signal message, the assistant sends the current conversation history before the new message.

A conversation remains active while messages are less than **24 hours apart**. If more than 24 hours passed since the last activity, previous messages are not sent to the model and the next message starts a fresh context.

Only the most recent **100 messages** can be sent as context. Stored rows older than 30 days are pruned. There is no application-side `pendingAction`, slot state machine or recent-entity context.

Example:

```text
You: Lekarz jutro o
Bot: O której godzinie masz wizytę?

You: 13
Bot: Gotowe. Lekarz jutro o 13:00. Przypomnę o 12:30.
```

The second message works because the model receives the previous user message and assistant question. If the first turn used a tool, its exact tool call and result are also present in history.

## Reminder semantics

Two times are modeled separately:

```text
eventAt       when the appointment/event occurs
scheduledAt   when Signal sends the notification
```

For an event:

```text
Dentysta w czwartek o 13
```

defaults to:

```text
event:        Thursday 13:00
notification: Thursday 12:30
```

Explicit notification timing overrides the default:

```text
Dentysta w czwartek o 13. Przypomnij mi rano.
```

becomes event 13:00 and notification 08:00 that day.

Deterministic dayparts:

```text
rano          → 08:00
po południu   → 15:00
wieczorem     → 19:00
```

A standalone reminder is different:

```text
Przypomnij mi jutro o 13 zadzwonić do lekarza
```

Here 13:00 is the notification itself; there is no separate event time.

## Tool boundary

Currently allowed:

```text
reminder_schedule
reminder_update
reminder_list
```

Execution path:

```text
model proposes tool call
        ↓
ToolRegistry validates name
        ↓
Policy checks capability
        ↓
Zod validates arguments
        ↓
domain repository/service
        ↓
SQLite
```

There is no generic SQL tool, reminder delete, shell, SSH, filesystem, Docker socket or arbitrary HTTP tool.

The OpenRouter loop is capped at four model rounds per Signal message.

## Model

Default:

```text
deepseek/deepseek-v4-flash-0731
```

Override with `OPENROUTER_MODEL`.

## Environment

```bash
cp .env.example .env
```

Minimum configuration:

```dotenv
SIGNAL_MODE=json-rpc-native
SIGNAL_HTTP_PORT=7070
ASSISTANT_HTTP_PORT=3010
SIGNAL_BOT_NUMBER=+48...
SIGNAL_OWNER_NUMBER=+48...
SIGNAL_OWNER_UUID=

OPENROUTER_API_KEY=sk-or-v1-...
OPENROUTER_MODEL=deepseek/deepseek-v4-flash-0731
ASSISTANT_TIMEZONE=Europe/Warsaw

DB_PATH=./data/assistant.sqlite
REMINDER_POLL_MS=15000
```

In Docker, SQLite is stored at `/data/assistant.sqlite` in the persistent `assistant-data` volume.

## Ports

```text
Raspberry Pi / host                 Docker network
127.0.0.1:7070  ───────────────▶  signal:8080
127.0.0.1:3010  ───────────────▶  assistant:3000
```

Container-to-container Signal access:

```text
assistant → http://signal:8080
```

## Register the dedicated Signal bot account

The bot uses its own phone number and is registered directly through `signal-cli`; it is not linked to the owner's Signal account.

### 1. Registration mode

Set:

```dotenv
SIGNAL_MODE=native
```

Start Signal:

```bash
docker compose up -d signal
curl http://127.0.0.1:7070/v1/accounts
```

### 2. Start registration

```bash
curl -X POST \
  -H "Content-Type: application/json" \
  "http://127.0.0.1:7070/v1/register/+48BOT_NUMBER"
```

If CAPTCHA is requested, open:

```text
https://signalcaptchas.org/registration/generate.html
```

Copy the fresh value beginning with `signal-hcaptcha.` and submit it directly:

```bash
curl -X POST \
  -H "Content-Type: application/json" \
  -d '{
    "captcha": "signal-hcaptcha.PASTE_FRESH_TOKEN_HERE",
    "use_voice": false
  }' \
  "http://127.0.0.1:7070/v1/register/+48BOT_NUMBER"
```

### 3. Verify SMS code

```bash
curl -X POST \
  -H "Content-Type: application/json" \
  "http://127.0.0.1:7070/v1/register/+48BOT_NUMBER/verify/123-456"
```

Then switch runtime mode back to:

```dotenv
SIGNAL_MODE=json-rpc-native
```

Fallback:

```dotenv
SIGNAL_MODE=json-rpc
```

## Owner UUID / sealed sender

Signal sealed-sender messages may identify the sender by UUID/ACI rather than phone number. After receiving a known owner message, set the logged UUID:

```dotenv
SIGNAL_OWNER_UUID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

UUID is then the preferred authorization identity. `SIGNAL_OWNER_NUMBER` remains the explicit reply recipient.

## Reminder persistence and delivery

Operational state survives rebuilds through:

```yaml
assistant-data:/data
```

Delivery uses `claim → send → mark-sent`. Failed sends are retried with bounded exponential backoff, and stale `sending` claims are recovered after restart.

Strict exactly-once delivery cannot be guaranteed across a crash exactly between external Signal send success and the local SQLite commit. At that narrow boundary a duplicate is preferable to silently losing a reminder.

## Updating on Raspberry Pi

```bash
git pull
bun install
bun test
bun run typecheck
docker compose build assistant
docker compose up -d
docker compose logs -f assistant
```

Health:

```bash
curl http://127.0.0.1:3010/health
```

The Signal image does not need to be rebuilt for assistant code changes.

## Persistent data

```yaml
signal-data:/home/.local/share/signal-cli
assistant-data:/data
```

Do not run this unless intentionally wiping both Signal identity and assistant state:

```bash
docker compose down -v
```

## Security boundaries

- dedicated standalone Signal bot account;
- direct messages only;
- owner authorization before any LLM request;
- UUID/ACI preferred once configured;
- unauthorized message bodies are not logged;
- localhost-only published APIs;
- OpenRouter receives conversational data, never Signal/API credentials;
- default-deny tool policy independent from the prompt;
- no generic SQL/database, destructive reminder, shell, SSH, Docker, filesystem, GitHub or Google credential tool.

## Development

```bash
bun install
bun test
bun run typecheck
bun run dev
```

Local state defaults to `./data/assistant.sqlite`; `data/` is gitignored.
