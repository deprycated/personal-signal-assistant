# Personal Signal Assistant — MVP

Self-hosted personal assistant with Signal as the only user interface.

Current vertical slice:

```text
Signal
  ↓
owner auth gate
  ↓
OpenRouter model
  ↓ native tool calls
ToolRegistry → Policy → domain services
                     ↓
              SQLite / Drizzle
                     ↓
                 scheduler
                     ↓
                  Signal
```

The assistant is natural-language-first: no slash commands, prefixes, or special syntax are required.

## Status

### M0 — Signal transport

- [x] Docker Compose
- [x] `signal-cli-rest-api`
- [x] Bun + TypeScript
- [x] WebSocket receive loop with reconnect/backoff
- [x] owner allowlist before application/LLM handling
- [x] Signal UUID/ACI support for sealed sender
- [x] group rejection
- [x] ignore sync/receipt/typing events
- [x] Signal replies through `/v2/send`
- [x] localhost-only published ports
- [x] parser/auth tests

### M1 — natural-language interpretation

- [x] OpenRouter integration
- [x] natural Polish input including typos and abbreviations
- [x] Zod runtime validation
- [x] auth happens before any model request
- [x] bounded model execution

### M2 — tool runtime, context, SQLite and reminders

- [x] native OpenRouter tool calling
- [x] explicit `ToolRegistry` and default-deny policy
- [x] no SQL tool and no direct database access for the model
- [x] SQLite + Drizzle operational state
- [x] persistent conversation context for incomplete actions
- [x] recent-entity context for corrections such as `a jednak 16:30`
- [x] reminder create/update/list tools
- [x] deterministic clarification replies
- [x] reminder scheduler with retry/backoff
- [x] stale delivery-claim recovery after process restart
- [x] idempotent reminder creation for a repeated Signal message/tool call
- [x] audit trail records decisions/IDs/timestamps rather than message bodies or secrets

Next milestones remain notes/recall, Google Calendar, and checkpoint/resume/`co teraz?`.

## Conversation behavior

The application stores a small, bounded conversation state instead of sending an unbounded chat transcript to the model.

Example:

```text
You: Dentysta jutro o
Bot: O której mam przypomnieć?

You: 13
Bot: Gotowe. Przypomnę 2026-08-21 o 13:00: dentysta.

You: a jednak 16:30
Bot: Zmienione. Przypomnę 2026-08-21 o 16:30: dentysta.
```

An incomplete action is retained for 24 hours. The most recently created/updated entity is retained as short correction context for 6 hours. The user can explicitly say `nieważne`, `anuluj` or equivalent; the model can then call the safe context-cancel tool.

## Tool boundary

The model does **not** receive a generic SQL tool. It only receives narrowly scoped capabilities currently allowed by application policy:

```text
reminder_schedule
reminder_update
reminder_list
conversation_cancel_pending
```

Flow:

```text
model proposes tool call
        ↓
ToolRegistry validates name
        ↓
Policy checks capability
        ↓
Zod validates arguments
        ↓
domain service / repository
        ↓
SQLite
```

There is no `sql_execute`, shell, SSH, filesystem, Docker socket, delete-reminder, or arbitrary HTTP tool.

The OpenRouter loop is capped at four model rounds per Signal message. This is a bounded request workflow, not an autonomous background agent loop.

## Model

Default:

```text
deepseek/deepseek-v4-flash-0731
```

Override it with `OPENROUTER_MODEL`. The application uses native `tools`/`tool_calls`; it no longer relies on the M1 `response_format` intent envelope.

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

`SIGNAL_OWNER_UUID` is optional during bootstrap, but recommended after the first known inbound message from the owner.

When running through Docker Compose, `DB_PATH` is set inside the container to `/data/assistant.sqlite` and persisted in the `assistant-data` volume.

## Ports

`signal-cli-rest-api` listens inside its container on port `8080`. The assistant listens inside its container on `3000`.

```text
Raspberry Pi / host                 Docker network
127.0.0.1:7070  ───────────────▶  signal:8080
127.0.0.1:3010  ───────────────▶  assistant:3000
```

Container-to-container Signal access:

```text
assistant → http://signal:8080
```

Changing `SIGNAL_HTTP_PORT` or `ASSISTANT_HTTP_PORT` changes only the host-side port.

## Register a dedicated Signal bot account without a second device

The bot uses its own phone number and is registered directly through `signal-cli`; it is not linked to the owner's Signal account and does not require Signal to be logged in on another phone.

### 1. Start Signal in registration mode

Set:

```dotenv
SIGNAL_MODE=native
```

Then:

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

Signal will normally ask for a CAPTCHA.

### 3. Solve CAPTCHA

Open:

```text
https://signalcaptchas.org/registration/generate.html
```

Solve the CAPTCHA and copy the **Open Signal** link. It looks like:

```text
signalcaptcha://signal-hcaptcha....
```

For the REST registration request, paste the value beginning with `signal-hcaptcha.` directly into the JSON body. No shell variable or `jq` is required:

```bash
curl -X POST \
  -H "Content-Type: application/json" \
  -d '{
    "captcha": "signal-hcaptcha.PASTE_FRESH_TOKEN_HERE",
    "use_voice": false
  }' \
  "http://127.0.0.1:7070/v1/register/+48BOT_NUMBER"
```

Use a fresh CAPTCHA and avoid repeated rapid registration attempts because Signal rate-limits registration.

### 4. Verify SMS code

For a code such as `123-456`:

```bash
curl -X POST \
  -H "Content-Type: application/json" \
  "http://127.0.0.1:7070/v1/register/+48BOT_NUMBER/verify/123-456"
```

Verify the account:

```bash
curl http://127.0.0.1:7070/v1/accounts
```

### 5. Test direct sending

```bash
curl -X POST \
  -H "Content-Type: application/json" \
  -d '{
    "message": "Test asystenta",
    "number": "+48BOT_NUMBER",
    "recipients": ["+48OWNER_NUMBER"]
  }' \
  "http://127.0.0.1:7070/v2/send"
```

### 6. Switch to runtime mode

```dotenv
SIGNAL_MODE=json-rpc-native
```

Fallback if unsupported by the platform:

```dotenv
SIGNAL_MODE=json-rpc
```

Then start the whole stack:

```bash
docker compose up -d --build
```

## Owner UUID / sealed sender

Signal can deliver sealed-sender messages without a phone number in the envelope. In that case the stable sender identifier is UUID/ACI.

After a known message from the owner, logs may contain:

```text
senderUuid=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

Set that exact value:

```dotenv
SIGNAL_OWNER_UUID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

Once configured, UUID is the preferred authorization identity. `SIGNAL_OWNER_NUMBER` remains the explicit recipient for replies.

## Reminder persistence and delivery

Operational state is stored in SQLite and survives container rebuilds through:

```yaml
assistant-data:/data
```

Reminder delivery uses a claim → send → mark-sent flow. Failed sends are retried with exponential backoff and stop after five failed delivery attempts. A `sending` claim left behind by a process crash is recovered after it becomes stale.

Strict exactly-once delivery cannot be guaranteed across a crash exactly between the external Signal send succeeding and the local SQLite commit. The implementation prefers recovering a possibly undelivered reminder over silently losing it, so that rare crash boundary can produce a duplicate.

## Running / updating on Raspberry Pi

For normal code updates:

```bash
git pull
docker compose build assistant
docker compose up -d
docker compose logs -f assistant
```

The Signal image is not rebuilt by `docker compose build assistant`.

Health:

```bash
curl http://127.0.0.1:3010/health
```

## Persistent data

Signal account identity/key material:

```yaml
signal-data:/home/.local/share/signal-cli
```

Assistant operational state:

```yaml
assistant-data:/data
```

Do not run this unless intentionally wiping both bot identity and assistant state:

```bash
docker compose down -v
```

Normal container restarts/rebuilds preserve both volumes.

## Security boundaries

- dedicated standalone Signal bot account;
- direct messages only;
- owner authorization happens before any LLM request;
- UUID/ACI is preferred once configured;
- unauthorized message bodies are not logged;
- Signal REST API is published on `127.0.0.1` only;
- assistant HTTP endpoint is published on `127.0.0.1` only;
- OpenRouter receives message/context data, never Signal/API credentials;
- tool names and arguments are validated before execution;
- policy is default-deny and independent from the model prompt;
- no generic SQL or arbitrary database tool;
- no destructive reminder tool in the MVP;
- no shell, SSH, Docker socket, filesystem, Google credential, or GitHub credential access;
- action execution is application code, not prompt instructions.

## Development

```bash
bun install
bun test
bun run typecheck
bun run dev
```

Local development state defaults to `./data/assistant.sqlite`; `data/` is gitignored.
