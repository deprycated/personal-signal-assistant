import { describe, expect, test } from "bun:test";
import { ConversationContextRepository } from "../context/repository";
import { createDatabase } from "../db/database";
import { ReminderRepository } from "../reminders/repository";
import { createReminderTools } from "./reminder-tools";
import { ToolPolicy, ToolRegistry } from "./registry";

function executionContext(sourceMessageKey: string, nowMs: number) {
  return { ownerKey: "owner", sourceMessageKey, toolCallIndex: 0, nowMs };
}

function createRegistry(reminders: ReminderRepository, contexts: ConversationContextRepository) {
  return new ToolRegistry(
    createReminderTools(reminders, contexts, "Europe/Warsaw"),
    new ToolPolicy(["reminder_schedule", "reminder_update", "reminder_list"]),
  );
}

describe("reminder tools", () => {
  test("preserves an incomplete reminder and completes it from the next message", async () => {
    const database = createDatabase(":memory:");
    try {
      const reminders = new ReminderRepository(database);
      const contexts = new ConversationContextRepository(database);
      const registry = createRegistry(reminders, contexts);
      const nowMs = Date.parse("2026-08-20T18:00:00Z");

      const incomplete = await registry.execute(
        "reminder_schedule",
        JSON.stringify({ title: "dentysta", date: "2026-08-21", time: null }),
        executionContext("signal:1", nowMs),
      );
      expect(incomplete.ok).toBe(true);
      expect(incomplete.directReply).toBe("O której mam przypomnieć?");
      expect(contexts.get("owner", nowMs).pendingAction?.arguments).toMatchObject({
        title: "dentysta",
        date: "2026-08-21",
        time: null,
      });

      const completed = await registry.execute(
        "reminder_schedule",
        JSON.stringify({ title: "dentysta", date: "2026-08-21", time: "13:00" }),
        executionContext("signal:2", nowMs + 1_000),
      );
      expect(completed.ok).toBe(true);
      expect(completed.directReply).toContain("13:00");
      expect(contexts.get("owner", nowMs + 1_000).pendingAction).toBeUndefined();
      expect(contexts.get("owner", nowMs + 1_000).lastEntity?.data).toMatchObject({
        title: "dentysta",
        date: "2026-08-21",
        time: "13:00",
      });
      const [stored] = reminders.listUpcoming(nowMs);
      expect(stored?.scheduledAtMs).toBe(Date.parse("2026-08-21T13:00:00+02:00"));
    } finally {
      database.close();
    }
  });

  test("updates the recent reminder without requiring the user to repeat its id", async () => {
    const database = createDatabase(":memory:");
    try {
      const reminders = new ReminderRepository(database);
      const contexts = new ConversationContextRepository(database);
      const registry = createRegistry(reminders, contexts);
      const nowMs = Date.parse("2026-08-20T18:00:00Z");

      await registry.execute(
        "reminder_schedule",
        JSON.stringify({ title: "dentysta", date: "2026-08-21", time: "13:00" }),
        executionContext("signal:1", nowMs),
      );
      const recentId = contexts.get("owner", nowMs).lastEntity?.id;
      expect(recentId).toBeTruthy();

      const updated = await registry.execute(
        "reminder_update",
        JSON.stringify({ reminderId: null, date: "2026-08-21", time: "16:30" }),
        executionContext("signal:2", nowMs + 1_000),
      );

      expect(updated.ok).toBe(true);
      expect(updated.directReply).toContain("16:30");
      expect(reminders.getById(recentId as string)?.scheduledAtMs).toBe(
        Date.parse("2026-08-21T16:30:00+02:00"),
      );
    } finally {
      database.close();
    }
  });

  test("creation is idempotent for the same Signal message and tool index", async () => {
    const database = createDatabase(":memory:");
    try {
      const reminders = new ReminderRepository(database);
      const contexts = new ConversationContextRepository(database);
      const registry = createRegistry(reminders, contexts);
      const nowMs = Date.parse("2026-08-20T18:00:00Z");
      const args = JSON.stringify({ title: "dentysta", date: "2026-08-21", time: "13:00" });

      await registry.execute("reminder_schedule", args, executionContext("signal:1", nowMs));
      await registry.execute("reminder_schedule", args, executionContext("signal:1", nowMs));

      expect(reminders.listUpcoming(nowMs)).toHaveLength(1);
    } finally {
      database.close();
    }
  });

  test("policy denies tools outside the explicit allowlist", async () => {
    const database = createDatabase(":memory:");
    try {
      const registry = new ToolRegistry([], new ToolPolicy([]));
      const result = await registry.execute(
        "sql_execute",
        "{}",
        executionContext("signal:1", Date.now()),
      );
      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe("DENIED_BY_POLICY");
    } finally {
      database.close();
    }
  });
});
