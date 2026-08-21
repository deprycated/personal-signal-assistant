import { describe, expect, test } from "bun:test";
import { createDatabase } from "../db/database";
import { ReminderRepository } from "../reminders/repository";
import { createReminderTools } from "./reminder-tools";
import { ToolPolicy, ToolRegistry } from "./registry";

function executionContext(sourceMessageKey: string, nowMs: number) {
  return { ownerKey: "owner", sourceMessageKey, toolCallIndex: 0, nowMs };
}

function createRegistry(reminders: ReminderRepository) {
  return new ToolRegistry(
    createReminderTools(reminders, "Europe/Warsaw"),
    new ToolPolicy(["reminder_schedule", "reminder_update", "reminder_list"]),
  );
}

function eventArgs(overrides: Record<string, unknown> = {}) {
  return {
    title: "dentysta",
    kind: "event",
    eventDate: "2026-08-22",
    eventTime: "13:00",
    reminderDate: null,
    reminderTime: null,
    reminderDaypart: null,
    minutesBefore: null,
    ...overrides,
  };
}

describe("reminder tools", () => {
  test("returns a clarification without server-side pending context", async () => {
    const database = createDatabase(":memory:");
    try {
      const registry = createRegistry(new ReminderRepository(database));
      const result = await registry.execute(
        "reminder_schedule",
        JSON.stringify(eventArgs({ eventTime: null })),
        executionContext("signal:1", Date.parse("2026-08-21T08:00:00Z")),
      );

      expect(result.ok).toBe(true);
      expect(result.directReply).toBe("O której jest wydarzenie?");
      expect(result.data).toMatchObject({
        status: "needs_clarification",
        draft: { title: "dentysta", eventDate: "2026-08-22", eventTime: null },
      });
    } finally {
      database.close();
    }
  });

  test("event reminders default to 30 minutes before the event", async () => {
    const database = createDatabase(":memory:");
    try {
      const reminders = new ReminderRepository(database);
      const registry = createRegistry(reminders);
      await registry.execute(
        "reminder_schedule",
        JSON.stringify(eventArgs()),
        executionContext("signal:1", Date.parse("2026-08-21T08:00:00Z")),
      );

      const [stored] = reminders.listUpcoming(Date.parse("2026-08-21T08:00:00Z"));
      expect(stored?.eventAtMs).toBe(Date.parse("2026-08-22T13:00:00+02:00"));
      expect(stored?.scheduledAtMs).toBe(Date.parse("2026-08-22T12:30:00+02:00"));
      expect(stored?.leadMinutes).toBe(30);
    } finally {
      database.close();
    }
  });

  test("explicit morning reminder is delivered at 08:00 on the event day", async () => {
    const database = createDatabase(":memory:");
    try {
      const reminders = new ReminderRepository(database);
      const registry = createRegistry(reminders);
      await registry.execute(
        "reminder_schedule",
        JSON.stringify(eventArgs({ reminderDaypart: "morning" })),
        executionContext("signal:1", Date.parse("2026-08-21T08:00:00Z")),
      );

      const [stored] = reminders.listUpcoming(Date.parse("2026-08-21T08:00:00Z"));
      expect(stored?.scheduledAtMs).toBe(Date.parse("2026-08-22T08:00:00+02:00"));
      expect(stored?.leadMinutes).toBeNull();
    } finally {
      database.close();
    }
  });

  test("event-time correction preserves the existing relative lead", async () => {
    const database = createDatabase(":memory:");
    try {
      const reminders = new ReminderRepository(database);
      const registry = createRegistry(reminders);
      await registry.execute(
        "reminder_schedule",
        JSON.stringify(eventArgs()),
        executionContext("signal:1", Date.parse("2026-08-21T08:00:00Z")),
      );
      const [created] = reminders.listUpcoming(Date.parse("2026-08-21T08:00:00Z"));
      expect(created).toBeTruthy();

      const result = await registry.execute(
        "reminder_update",
        JSON.stringify({
          reminderId: created!.id,
          kind: null,
          eventDate: null,
          eventTime: "14:00",
          reminderDate: null,
          reminderTime: null,
          reminderDaypart: null,
          minutesBefore: null,
        }),
        executionContext("signal:2", Date.parse("2026-08-21T08:01:00Z")),
      );

      expect(result.ok).toBe(true);
      const updated = reminders.getById(created!.id);
      expect(updated?.eventAtMs).toBe(Date.parse("2026-08-22T14:00:00+02:00"));
      expect(updated?.scheduledAtMs).toBe(Date.parse("2026-08-22T13:30:00+02:00"));
      expect(updated?.leadMinutes).toBe(30);
    } finally {
      database.close();
    }
  });

  test("standalone reminder fires exactly at its requested notification time", async () => {
    const database = createDatabase(":memory:");
    try {
      const reminders = new ReminderRepository(database);
      const registry = createRegistry(reminders);
      await registry.execute(
        "reminder_schedule",
        JSON.stringify({
          title: "zadzwoń do lekarza",
          kind: "standalone",
          eventDate: null,
          eventTime: null,
          reminderDate: "2026-08-22",
          reminderTime: "13:00",
          reminderDaypart: null,
          minutesBefore: null,
        }),
        executionContext("signal:1", Date.parse("2026-08-21T08:00:00Z")),
      );

      const [stored] = reminders.listUpcoming(Date.parse("2026-08-21T08:00:00Z"));
      expect(stored?.eventAtMs).toBeNull();
      expect(stored?.scheduledAtMs).toBe(Date.parse("2026-08-22T13:00:00+02:00"));
    } finally {
      database.close();
    }
  });
});
