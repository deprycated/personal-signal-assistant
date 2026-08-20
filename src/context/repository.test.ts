import { describe, expect, test } from "bun:test";
import { createDatabase } from "../db/database";
import { ConversationContextRepository } from "./repository";

describe("ConversationContextRepository", () => {
  test("stores a pending action and expires it", () => {
    const database = createDatabase(":memory:");
    try {
      const contexts = new ConversationContextRepository(database);
      contexts.setPending(
        "owner",
        {
          tool: "reminder_schedule",
          arguments: { title: "dentysta", date: "2026-08-21", time: null },
          missingInformation: ["time"],
        },
        1_000,
        500,
      );

      expect(contexts.get("owner", 1_400).pendingAction).toEqual({
        tool: "reminder_schedule",
        arguments: { title: "dentysta", date: "2026-08-21", time: null },
        missingInformation: ["time"],
      });
      expect(contexts.get("owner", 1_501).pendingAction).toBeUndefined();
    } finally {
      database.close();
    }
  });

  test("clearing pending context keeps the recent entity", () => {
    const database = createDatabase(":memory:");
    try {
      const contexts = new ConversationContextRepository(database);
      contexts.setPending(
        "owner",
        {
          tool: "reminder_schedule",
          arguments: { title: "dentysta" },
          missingInformation: ["time"],
        },
        1_000,
      );
      contexts.setLastEntity(
        "owner",
        {
          type: "reminder",
          id: "reminder-1",
          action: "created",
          data: { title: "dentysta", date: "2026-08-21", time: "13:00" },
        },
        1_000,
      );
      contexts.clearPending("owner", 1_100);

      const snapshot = contexts.get("owner", 1_200);
      expect(snapshot.pendingAction).toBeUndefined();
      expect(snapshot.lastEntity?.id).toBe("reminder-1");
      expect(snapshot.lastEntity?.data.time).toBe("13:00");
    } finally {
      database.close();
    }
  });
});
