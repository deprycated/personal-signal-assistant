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

function eventArgs(overrides: Record<string, unknown> = {}) {
  return {
    title: "dentysta",
    kind: "event",
    eventDate: "2026-08-21",
    eventTime: "13:00",
    reminderDate: null,
    reminderTime: null,
    reminderDaypart: null,
    minutesBefore: null,
    ...overrides,
  };
}

function updateArgs(overrides: Record<string, unknown> = {}) {
  return {
    reminderId: null,
    kind: null,
    eventDate: null,
    eventTime: null,
    reminderDate: null,
    reminderTime: null,
    reminderDaypart: null,
    minutesBefore: null,
    ...overrides,
  };
}

describe("reminder tools", () => {
  test("completes an appointment and defaults notification to 30 minutes before", async () => {
    const database = createDatabase(":memory:");
    try {
      const reminders = new ReminderRepository(database);
      const contexts = new ConversationContextRepository(database);
      const registry = createRegistry(reminders, contexts);
      const nowMs = Date.parse("2026-08-20T18:00:00Z");

      const incomplete = await registry.execute(
        "reminder_schedule",
        JSON.stringify(eventArgs({ eventTime: null })),
        executionContext("signal:1", nowMs),
      );
      expect(incomplete.ok).toBe(true);
      expect(incomplete.directReply).toBe("O której jest wydarzenie?");
      expect(contexts.get("owner", nowMs).pendingAction?.arguments).toMatchObject({
        title: "dentysta",
        kind: "event",
        eventDate: "2026-08-21",
        eventTime: null,
      });

      const completed = await registry.execute(
        "reminder_schedule",
        JSON.stringify(eventArgs()),
        executionContext("signal:2", nowMs + 1_000),
      );
      expect(completed.ok).toBe(true);
      expect(completed.directReply).toContain("13:00");
      expect(completed.directReply).toContain("12:30");
      expect(contexts.get("owner", nowMs + 1_000).pendingAction).toBeUndefined();
      expect(contexts.get("owner", nowMs + 1_000).lastEntity?.data).toMatchObject({
        title: "dentysta",
        kind: "event",
        eventDate: "2026-08-21",
        eventTime: "13:00",
        minutesBefore: 30,
      });

      const [stored] = reminders.listUpcoming(nowMs);
      expect(stored?.eventAtMs).toBe(Date.parse("2026-08-21T13:00:00+02:00"));
      expect(stored?.scheduledAtMs).toBe(Date.parse("2026-08-21T12:30:00+02:00"));
      expect(stored?.leadMinutes).toBe(30);
    } finally {
      database.close();
    }
  });

  test("supports an explicit same-day morning notification before an event", async () => {
    const database = createDatabase(":memory:");
    try {
      const reminders = new ReminderRepository(database);
      const contexts = new ConversationContextRepository(database);
      const registry = createRegistry(reminders, contexts);
      const nowMs = Date.parse("2026-08-20T18:00:00Z");

      const result = await registry.execute(
        "reminder_schedule",
        JSON.stringify(eventArgs({ reminderDaypart: "morning" })),
        executionContext("signal:morning", nowMs),
      );

      expect(result.ok).toBe(true);
      expect(result.directReply).toContain("08:00");
      const [stored] = reminders.listUpcoming(nowMs);
      expect(stored?.eventAtMs).toBe(Date.parse("2026-08-21T13:00:00+02:00"));
      expect(stored?.scheduledAtMs).toBe(Date.parse("2026-08-21T08:00:00+02:00"));
      expect(stored?.leadMinutes).toBeNull();
    } finally {
      database.close();
    }
  });

  test("changing the event time preserves the 30-minute relative notification", async () => {
    const database = createDatabase(":memory:");
    try {
      const reminders = new ReminderRepository(database);
      const contexts = new ConversationContextRepository(database);
      const registry = createRegistry(reminders, contexts);
      const nowMs = Date.parse("2026-08-20T18:00:00Z");

      await registry.execute(
        "reminder_schedule",
        JSON.stringify(eventArgs()),
        executionContext("signal:1", nowMs),
      );
      const recentId = contexts.get("owner", nowMs).lastEntity?.id;
      expect(recentId).toBeTruthy();

      const updated = await registry.execute(
        "reminder_update",
        JSON.stringify(updateArgs({ eventTime: "16:30" })),
        executionContext("signal:2", nowMs + 1_000),
      );

      expect(updated.ok).toBe(true);
      expect(updated.directReply).toContain("16:30");
      expect(updated.directReply).toContain("16:00");
      const stored = reminders.getById(recentId as string);
      expect(stored?.eventAtMs).toBe(Date.parse("2026-08-21T16:30:00+02:00"));
      expect(stored?.scheduledAtMs).toBe(Date.parse("2026-08-21T16:00:00+02:00"));
      expect(stored?.leadMinutes).toBe(30);
    } finally {
      database.close();
    }
  });

  test("supports standalone reminders where requested time is the notification time", async () => {
    const database = createDatabase(":memory:");
    try {
      const reminders = new ReminderRepository(database);
      const contexts = new ConversationContextRepository(database);
      const registry = createRegistry(reminders, contexts);
      const nowMs = Date.parse("2026-08-20T18:00:00Z");

      const result = await registry.execute(
        "reminder_schedule",
        JSON.stringify({
          title: "zadzwonić do dentysty",
          kind: "standalone",
          eventDate: null,
          eventTime: null,
          reminderDate: "2026-08-21",
          reminderTime: "13:00",
          reminderDaypart: null,
          minutesBefore: null,
        }),
        executionContext("signal:standalone", nowMs),
      );

      expect(result.ok).toBe(true);
      const [stored] = reminders.listUpcoming(nowMs);
      expect(stored?.eventAtMs).toBeNull();
      expect(stored?.scheduledAtMs).toBe(Date.parse("2026-08-21T13:00:00+02:00"));
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
      const args = JSON.stringify(eventArgs());

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
