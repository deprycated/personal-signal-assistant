# AGENTS.md

## Project

Self-hosted, single-user personal assistant with Signal as the only UI.
Natural language first; no required commands, prefixes, or special syntax.

## Architecture rules

- Keep the implementation simple. Do not add infrastructure or abstractions without a concrete need.
- Authenticate the Signal sender **before** any LLM or tool call.
- The LLM may interpret language and request narrow tools; application code owns policy, validation, persistence, time handling, and side effects.
- Tool access is default-deny. Never add generic SQL, shell, SSH, filesystem, Docker socket, arbitrary HTTP, or secret access.
- Validate tool arguments with Zod before execution.
- SQLite/Drizzle is the operational store. Preserve data across container rebuilds and use explicit migrations.
- Conversation context is the active message history: reset after 24h inactivity, send at most the latest 100 messages, and preserve tool calls/results. Do not reintroduce a conversation state machine unless proven necessary.
- For event reminders, event time and notification time are separate. Default notification is 30 minutes before the event.
- Resolve dates, timezone, and DST in application code using `Europe/Warsaw`; do not trust the model to calculate offsets.
- No destructive tools in MVP unless explicitly requested.

## Development

Before changing behavior, read the relevant code plus `README.md` and `PROJECT_PLAN.md`.

Run when possible:

```bash
bun test
bun run typecheck
```

Add/update tests for behavior changes. Keep commits focused. Update documentation only when product behavior, configuration, or architecture changes.

Never run `docker compose down -v` unless data destruction is explicitly intended.
