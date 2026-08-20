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

`SIGNAL_BOT_NUMBER` to osobny numer przeznaczony dla bota. Konto bota jest rejestrowane bezpośrednio przez `signal-cli`; nie trzeba logować tego numeru w aplikacji Signal na drugim telefonie ani linkować go jako dodatkowego urządzenia.

`SIGNAL_OWNER_NUMBER` to Twój prywatny numer Signal, z którego będziesz pisać do asystenta.

## Porty Signal API

`signal-cli-rest-api` nasłuchuje **wewnątrz kontenera na porcie 8080**. Domyślnie wystawiamy go na hoście jako `127.0.0.1:7070`, aby uniknąć konfliktów z innymi usługami.

```text
host / Raspberry Pi              Docker network
127.0.0.1:7070  ───────────────▶ signal:8080
                                      ▲
                                      │
                               assistant: Bun
```

Dlatego:

- z Raspberry Pi używaj `http://127.0.0.1:7070`;
- z kontenera `assistant` używaj `http://signal:8080`;
- zmiana `SIGNAL_HTTP_PORT` zmienia tylko port po stronie hosta, nie port wewnątrz kontenera.

Poprawne mapowanie w Compose:

```yaml
ports:
  - "127.0.0.1:${SIGNAL_HTTP_PORT:-7070}:8080"
```

Po uruchomieniu `docker ps` powinien pokazać m.in.:

```text
127.0.0.1:7070->8080/tcp
```

## Rejestracja osobnego konta Signal bez drugiego urządzenia

### 1. Uruchom tylko serwis Signal

Na czas rejestracji ustaw:

```dotenv
SIGNAL_MODE=native
```

Uruchom:

```bash
docker compose up -d signal
```

API jest dostępne lokalnie pod:

```text
http://127.0.0.1:7070
```

Sprawdzenie:

```bash
curl http://127.0.0.1:7070/v1/accounts
```

### 2. Rozpocznij rejestrację numeru bota

```bash
curl -X POST \
  -H "Content-Type: application/json" \
  "http://127.0.0.1:7070/v1/register/+48NUMER_BOTA"
```

Signal zwykle wymaga CAPTCHA i może zwrócić:

```json
{
  "error": "Captcha required for verification..."
}
```

### 3. Wygeneruj CAPTCHA

Otwórz:

```text
https://signalcaptchas.org/registration/generate.html
```

Rozwiąż CAPTCHA, następnie skopiuj adres linku **Open Signal**.

Link wygląda mniej więcej tak:

```text
signalcaptcha://signal-hcaptcha....
```

Dla REST API przekaż wartość bez prefiksu `signalcaptcha://`, czyli zaczynając od:

```text
signal-hcaptcha....
```

Wklej świeżo wygenerowany token bezpośrednio do requestu:

```bash
curl -X POST \
  -H "Content-Type: application/json" \
  -d '{
    "captcha": "signal-hcaptcha.TUTAJ_WKLEJ_SWIeZY_TOKEN",
    "use_voice": false
  }' \
  "http://127.0.0.1:7070/v1/register/+48NUMER_BOTA"
```

Nie jest wymagane `jq` ani żadna zmienna powłoki. Używaj świeżo wygenerowanej CAPTCHA i nie wykonuj wielu prób rejestracji jedna po drugiej — Signal stosuje rate limiting.

### 4. Zweryfikuj kod SMS

Po otrzymaniu kodu, np. `123-456`:

```bash
curl -X POST \
  -H "Content-Type: application/json" \
  "http://127.0.0.1:7070/v1/register/+48NUMER_BOTA/verify/123-456"
```

Po poprawnej weryfikacji konto bota jest samodzielnym kontem Signal obsługiwanym przez `signal-cli`.

### 5. Sprawdź zarejestrowane konto

```bash
curl http://127.0.0.1:7070/v1/accounts
```

Na liście powinien pojawić się `SIGNAL_BOT_NUMBER`.

### 6. Przetestuj wysyłkę z bota

```bash
curl -X POST \
  -H "Content-Type: application/json" \
  -d '{
    "message": "Test asystenta",
    "number": "+48NUMER_BOTA",
    "recipients": ["+48TWOJ_NUMER"]
  }' \
  "http://127.0.0.1:7070/v2/send"
```

### 7. Przełącz Signal w tryb roboczy

Po rejestracji ustaw:

```dotenv
SIGNAL_MODE=json-rpc-native
```

Jeśli platforma nie wspiera tego trybu, użyj:

```dotenv
SIGNAL_MODE=json-rpc
```

Uruchom cały stack:

```bash
docker compose up -d --build
```

Logi:

```bash
docker compose logs -f assistant
```

## Ustalenie UUID właściciela

Wiadomości Signal mogą przychodzić jako sealed sender, bez numeru telefonu w envelope. W takim przypadku identyfikatorem nadawcy jest Signal UUID/ACI.

Po pierwszej wiadomości od właściciela możesz zobaczyć w logu identyfikator w rodzaju:

```text
senderUuid=ff603517-3b21-4274-b31b-b0714a6f5a5f
```

Jeśli potwierdziłeś, że wiadomość została wysłana z Twojego prywatnego konta Signal, ustaw:

```dotenv
SIGNAL_OWNER_UUID=ff603517-3b21-4274-b31b-b0714a6f5a5f
```

Następnie przebuduj serwis:

```bash
docker compose up -d --build assistant
```

Po skonfigurowaniu UUID jest on preferowanym identyfikatorem właściciela. Numer telefonu pozostaje przydatny do bootstrapu i jako docelowy recipient odpowiedzi.

## Test round-trip

Wyślij ze swojego prywatnego konta Signal do numeru bota:

```text
ping
```

Odpowiedź:

```text
pong
```

Pozostałe wiadomości w M0 są odpowiadane prostym `Odebrałem: ...` — wyłącznie po to, by przetestować transport.

## Dane konta Signal

Dane konta są przechowywane w Docker volume `signal-data`:

```yaml
volumes:
  - signal-data:/home/.local/share/signal-cli
```

Restart lub aktualizacja kontenera nie wymaga ponownej rejestracji, o ile volume pozostaje zachowany.

Nie wykonuj bez potrzeby:

```bash
docker compose down -v
```

`-v` usuwa volume i może usunąć lokalne dane konta Signal, co może wymusić ponowną rejestrację.

## Security

- konto bota jest osobnym, samodzielnym kontem Signal;
- wiadomość jest autoryzowana **przed** handlerem aplikacyjnym i przed przyszłą warstwą LLM;
- po skonfigurowaniu `SIGNAL_OWNER_UUID` autoryzacja preferuje Signal UUID/ACI;
- numer telefonu jest fallbackiem bootstrapowym i służy jako recipient odpowiedzi;
- group messages są odrzucane;
- sync/receipt/typing events nie są traktowane jako polecenia;
- wiadomości obcych nie otrzymują odpowiedzi;
- treść obcej wiadomości nie jest logowana;
- `signal-cli-rest-api` jest dostępne z hosta tylko przez `127.0.0.1`;
- brak Docker socket, SSH i shell tools;
- przyszły LLM nie dostanie credentiali Signal ani innych sekretów.

## Endpointy

Assistant health:

```bash
curl http://127.0.0.1:3000/health
```

Signal API z hosta:

```text
http://127.0.0.1:7070
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
