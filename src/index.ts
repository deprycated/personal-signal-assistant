import { AssistantApp } from "./app";
import { OpenRouterIntentClient } from "./ai/openrouter";
import { loadConfig } from "./config";
import { createDatabase } from "./db/database";
import { logger } from "./logger";
import { ReminderRepository } from "./reminders/repository";
import { ReminderScheduler } from "./reminders/scheduler";
import { SignalClient } from "./signal/client";
import { SignalListener } from "./signal/listener";

const config = loadConfig();
const database = createDatabase(config.dbPath);
const signalClient = new SignalClient(config.signalApiUrl, config.signalBotNumber);
const reminders = new ReminderRepository(database);
const reminderScheduler = new ReminderScheduler(
  reminders,
  signalClient,
  config.signalOwnerNumber,
  config.reminderPollMs,
);
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

reminderScheduler.start();
logger.info("Assistant HTTP server started", {
  port: server.port,
  openRouterModel: config.openRouterModel,
  assistantTimezone: config.assistantTimezone,
  reminderPollMs: config.reminderPollMs,
});

let shuttingDown = false;
function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info("Shutting down", { signal });
  listener.stop();
  reminderScheduler.stop();
  server.stop();
  database.close();
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

await listener.run();
