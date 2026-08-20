export type AppConfig = {
  port: number;
  signalApiUrl: string;
  signalBotNumber: string;
  signalOwnerNumber: string;
  signalOwnerUuid?: string;
  openRouterApiKey: string;
  openRouterModel: string;
  assistantTimezone: string;
  dbPath: string;
  reminderPollMs: number;
};

function required(name: string): string {
  const value = Bun.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function optional(name: string): string | undefined {
  const value = Bun.env[name]?.trim();
  return value || undefined;
}

function positiveInteger(name: string, fallback: number): number {
  const raw = Bun.env[name]?.trim();
  const value = raw ? Number(raw) : fallback;
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`Invalid ${name}: ${raw}`);
  }
  return value;
}

export function loadConfig(): AppConfig {
  const port = positiveInteger("PORT", 3000);
  if (port > 65535) throw new Error(`Invalid PORT: ${port}`);

  return {
    port,
    signalApiUrl: required("SIGNAL_API_URL").replace(/\/+$/, ""),
    signalBotNumber: required("SIGNAL_BOT_NUMBER"),
    signalOwnerNumber: required("SIGNAL_OWNER_NUMBER"),
    signalOwnerUuid: optional("SIGNAL_OWNER_UUID"),
    openRouterApiKey: required("OPENROUTER_API_KEY"),
    openRouterModel: optional("OPENROUTER_MODEL") ?? "qwen/qwen3.5-flash-02-23",
    assistantTimezone: optional("ASSISTANT_TIMEZONE") ?? "Europe/Warsaw",
    dbPath: optional("DB_PATH") ?? "/data/assistant.sqlite",
    reminderPollMs: positiveInteger("REMINDER_POLL_MS", 15_000),
  };
}
