# Personal Signal Assistant — MVP

Pierwszy pionowy slice projektu:

**Signal → auth gate → Bun/TypeScript → Signal response**

Na tym etapie celowo nie ma OpenRoutera, SQLite ani Google Calendar. Najpierw stabilizujemy i testujemy bezpieczny transport wiadomości.

## Plan projektu

### M0 — Signal transport
- [x] Docker Compose
- [x] `signal-cli-rest-api`
- [x] Bun + TypeScript
- [x] WebSocket receive loop
- [x] reconnect z exponential backoff
- [x] allowlista właściciela przed handlerem aplikacyjnym
- [x] opcjonalna weryfikacja Signal UUID
- [x] odrzucanie grup
- [x] ignorowanie sync/receipt/typing events
- [x] wysyłanie odpowiedzi przez `/v2/send`
- [x] localhost-only ports
- [x] podstawowe testy parsera i auth

**DoD:** `ping` od właściciela → `pong`; wiadomość od obcego → brak odpowiedzi i brak przekazania dalej.

### M1 — OpenRouter / natural language
- [ ] OpenRouter client
- [ ] strict structured output / JSON Schema
- [ ] Zod jako runtime validator
- [ ] intents: `reply`, `create_note`, `search_notes`, `create_reminder`, `update_reminder`, `calendar_query`, `calendar_create`, `checkpoint_save`, `checkpoint_resume`, `plan_now`, `ambiguous`
- [ ] `confidence` + `missingInformation`
- [ ] follow-up context, np. `a jednak 16:30`

**DoD:** `jtro 17 dentsta` jest poprawnie interpretowane, a brakujące istotne dane powodują jedno krótkie pytanie zamiast zgadywania.

### M2 — SQLite + reminders
- [ ] Drizzle + SQLite
- [ ] `messages`
- [ ] `conversation_context`
- [ ] `reminders`
- [ ] `pending_actions`
- [ ] `audit_log`
- [ ] scheduler
- [ ] reminders wysyłane przez Signal

### M3 — notes + recall
- [ ] Inbox
- [ ] `note.create`
- [ ] `note.search`
- [ ] Markdown
- [ ] okresowy Git sync do jednego prywatnego repo
- [ ] oryginalny Inbox pozostaje historią; LLM nie kasuje wejścia

### M4 — Google Calendar
- [ ] minimalny OAuth scope
- [ ] read
- [ ] create
- [ ] delete wyłączone w MVP

### M5 — checkpoint / resume / co-teraz
- [ ] project contexts
- [ ] checkpoint save/resume
- [ ] `co teraz?` zwraca maks. 1–3 konkretne propozycje

## Pierwsze uruchomienie

```bash
cp .env.example .env
```

Ustaw numery w formacie E.164:

```dotenv
SIGNAL_BOT_NUMBER=+48...
SIGNAL_OWNER_NUMBER=+48...
```

### 1. Sparowanie konta Signal

Na czas pierwszego linkowania ustaw:

```dotenv
SIGNAL_MODE=native
```

Uruchom:

```bash
docker compose up -d signal
```

Otwórz na maszynie z Dockerem:

```text
http://127.0.0.1:8080/v1/qrcodelink?device_name=personal-assistant
```

W Signal: **Settings → Linked devices → +** i zeskanuj kod QR.

Dane Signal są zachowywane w volume `signal-data`.

### 2. Tryb roboczy

Po sparowaniu zmień:

```dotenv
SIGNAL_MODE=json-rpc-native
```

Jeśli platforma nie wspiera tego trybu, użyj `json-rpc`.

Uruchom cały stack:

```bash
docker compose up -d --build
```

Logi:

```bash
docker compose logs -f assistant
```

### 3. Test round-trip

Wyślij z numeru właściciela do bota:

```text
ping
```

Odpowiedź:

```text
pong
```

Pozostałe wiadomości w M0 są odpowiadane prostym `Odebrałem: ...` — wyłącznie po to, by przetestować transport.

## Security

- `SIGNAL_OWNER_NUMBER` jest sprawdzany **przed** handlerem aplikacyjnym.
- Po poznaniu UUID właściciela ustaw też `SIGNAL_OWNER_UUID`; wtedy wymagany jest jednocześnie właściwy numer i UUID.
- group messages są odrzucane.
- sync/receipt/typing events nie są traktowane jako polecenia.
- wiadomości obcych nie otrzymują odpowiedzi.
- treść obcej wiadomości nie jest logowana.
- `signal-cli-rest-api` jest dostępne z hosta tylko przez `127.0.0.1`.
- brak Docker socket, SSH i shell tools.
- przyszły LLM nie dostanie credentiali Signal ani innych sekretów.

## Endpointy

Assistant health:

```bash
curl http://127.0.0.1:3000/health
```

Wewnętrznie kontenery komunikują się przez:

```text
assistant → http://signal:8080
```

## Development

```bash
bun install
bun run dev
bun test
bun run typecheck
```
