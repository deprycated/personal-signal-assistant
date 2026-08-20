import { OpenRouterAgentClient } from "./ai/agent";
import { AssistantApp } from "./app";
import { loadConfig } from "./config";
import { ConversationContextRepository } from "./context/repository";
import { createDatabase } from "./db/database";
import { logger } from "./logger";
import { ReminderRepository } from "./reminders/repository";
import { ReminderScheduler } from "./reminders/scheduler";
import { SignalClient } from "./signal/client";
import { SignalListener } from "./signal/listener";
import { createReminderTools } from "./tools/reminder-tools";
import { ToolPolicy, ToolRegistry } from "./tools/registry";

const config = loadConfig();
const database = createDatabase(config.dbPath);
const signalClient = new SignalClient(config.signalApiUrl, config.signalBotNumber);
const reminders = new ReminderRepository(database);
const contexts = new ConversationContextRepository(database);
const reminderScheduler = new ReminderScheduler(
  reminders,
  signalClient,
  config.signalOwnerNumber,
  config.reminderPollMs,
);

const toolPolicy = new ToolPolicy(["reminder_schedule", "reminder_update", "reminder_list"]);
const toolRegistry = new ToolRegistry(createReminderTools(reminders, contexts), toolPolicy);
const agent = new OpenRouterAgentClient(
  {
    apiKey: config.openRouterApiKey,
    model: config.openRouterModel,
    timezone: config.assistantTimezone,
  },
  toolRegistry,
);
const ownerKey = config.signalOwnerUuid ?? config.signalOwnerNumber;
const app = new AssistantApp(
  signalClient,
  agent,
  contexts,
  config.signalOwnerNumber,
  ownerKey,
);
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
  enabledTools: toolRegistry.definitions().map((tool) => tool.function.name).join(","),
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
