import { AssistantApp } from "./app";
import { OpenRouterIntentClient } from "./ai/openrouter";
import { loadConfig } from "./config";
import { logger } from "./logger";
import { SignalClient } from "./signal/client";
import { SignalListener } from "./signal/listener";

const config = loadConfig();
const signalClient = new SignalClient(config.signalApiUrl, config.signalBotNumber);
const intentClient = new OpenRouterIntentClient({
  apiKey: config.openRouterApiKey,
  model: config.openRouterModel,
  timezone: config.assistantTimezone,
});
const app = new AssistantApp(signalClient, intentClient, config.signalOwnerNumber);
const listener = new SignalListener(config, (message) => app.handleMessage(message));

const server = Bun.serve({
  port: config.port,
  hostname: "0.0.0.0",
  routes: {
    "/health": () => Response.json({ status: "ok", service: "personal-signal-assistant" }),
  },
  fetch: () => new Response("Not Found", { status: 404 }),
});

logger.info("Assistant HTTP server started", {
  port: server.port,
  openRouterModel: config.openRouterModel,
  assistantTimezone: config.assistantTimezone,
});

function shutdown(signal: string) {
  logger.info("Shutting down", { signal });
  listener.stop();
  server.stop();
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

await listener.run();
