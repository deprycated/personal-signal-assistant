# Personal Signal Assistant — MVP

Self-hosted personal assistant with Signal as the only user interface.

Current vertical slice:

**Signal → owner auth gate → OpenRouter structured intent → safe response → Signal**

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

### M1 — OpenRouter / natural language

- [x] OpenRouter client
- [x] strict JSON Schema structured output
- [x] Zod runtime validation
- [x] intents: `reply`, `create_note`, `search_notes`, `create_reminder`, `update_reminder`, `calendar_query`, `calendar_create`, `checkpoint_save`, `checkpoint_resume`, `plan_now`, `ambiguous`
- [x] confidence + missing-information handling
- [x] natural Polish input including typos and abbreviations
- [x] deterministic policy boundary: the model interprets but does not execute actions
- [ ] persisted conversational follow-up context (`a jednak 16:30`) — M2

Action intents are currently recognized but not executed. Persistence/reminders arrive in M2.

Default model:

```text
qwen/qwen3.5-flash-02-23
```

Override it with `OPENROUTER_MODEL`.

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
OPENROUTER_MODEL=qwen/qwen3.5-flash-02-23
ASSISTANT_TIMEZONE=Europe/Warsaw
```

`SIGNAL_OWNER_UUID` is optional during bootstrap, but recommended after the first inbound message from the owner.

## Ports

`signal-cli-rest-api` listens inside its container on port `8080`. The host port is intentionally different:

```text
Raspberry Pi / host                 Docker network
127.0.0.1:7070  ───────────────▶  signal:8080
127.0.0.1:3010  ───────────────▶  assistant:3000
                                      ▲
                                      │
                                 Bun assistant
```

Container-to-container communication uses:

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

For this REST registration request, paste the value beginning with `signal-hcaptcha.` directly into the JSON body; no shell variable or `jq` is required:

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

Once configured, UUID is the preferred authorization identity. `SIGNAL_OWNER_NUMBER` remains the bootstrap fallback and the explicit recipient for replies.

## OpenRouter intent layer

Authorized non-`ping` messages are sent to OpenRouter only after the Signal auth gate succeeds.

The model returns a strict structured object containing:

- one allowed intent;
- confidence from `0` to `1`;
- a short optional reply;
- missing information;
- normalized action arguments.

The result is validated again with Zod before application code accepts it. The LLM does **not** execute actions directly.

Examples the intent layer is expected to understand:

```text
jtro 17 dentsta
jutro koło 17 dentysta
dentysta jutro 17
```

If required information is absent:

```text
dentysta jutro
```

it should ask one short clarification question rather than inventing a time.

At M1, action intents are intentionally not persisted or executed. M2 introduces SQLite, conversation context and reminders.

## Smoke tests

Transport:

```text
ping
```

Expected:

```text
pong
```

Health:

```bash
curl http://127.0.0.1:3010/health
```

Logs:

```bash
docker compose logs -f assistant
```

## Signal account data

Signal identity/key material lives in the Docker volume:

```yaml
signal-data:/home/.local/share/signal-cli
```

Do not run this unless intentionally wiping the bot account state:

```bash
docker compose down -v
```

Normal container restarts/rebuilds preserve the volume.

## Security boundaries

- dedicated standalone Signal bot account;
- direct messages only;
- owner authorization happens before any LLM request;
- UUID/ACI is preferred once configured;
- unauthorized message bodies are not logged;
- Signal REST API is published on `127.0.0.1` only;
- assistant HTTP endpoint is published on `127.0.0.1` only;
- the LLM never receives Signal/API credentials;
- the LLM interprets requests but cannot directly access shell, SSH, Docker socket, Google credentials, or GitHub credentials;
- action execution is implemented in application policy/tool layers, not in the prompt.

## Development

```bash
bun install
bun test
bun run typecheck
bun run dev
```
