export type AppConfig = {
  port: number;
  signalApiUrl: string;
  signalBotNumber: string;
  signalOwnerNumber: string;
  signalOwnerUuid?: string;
  openRouterApiKey: string;
  openRouterModel: string;
  assistantTimezone: string;
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

export function loadConfig(): AppConfig {
  const port = Number(Bun.env.PORT ?? "3000");
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid PORT: ${Bun.env.PORT}`);
  }

  return {
    port,
    signalApiUrl: required("SIGNAL_API_URL").replace(/\/+$/, ""),
    signalBotNumber: required("SIGNAL_BOT_NUMBER"),
    signalOwnerNumber: required("SIGNAL_OWNER_NUMBER"),
    signalOwnerUuid: optional("SIGNAL_OWNER_UUID"),
    openRouterApiKey: required("OPENROUTER_API_KEY"),
    openRouterModel: optional("OPENROUTER_MODEL") ?? "qwen/qwen3.5-flash-02-23",
    assistantTimezone: optional("ASSISTANT_TIMEZONE") ?? "Europe/Warsaw",
  };
}
