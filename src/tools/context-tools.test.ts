import { describe, expect, test } from "bun:test";
import { ConversationContextRepository } from "../context/repository";
import { createDatabase } from "../db/database";
import { createContextTools } from "./context-tools";
import { ToolPolicy, ToolRegistry } from "./registry";

describe("conversation context tools", () => {
  test("explicit cancellation clears only the pending action", async () => {
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
      );
      contexts.setLastEntity(
        "owner",
        {
          type: "reminder",
          id: "reminder-1",
          action: "created",
          data: { title: "inne" },
        },
        1_000,
      );

      const registry = new ToolRegistry(
        createContextTools(contexts),
        new ToolPolicy(["conversation_cancel_pending"]),
      );
      const result = await registry.execute("conversation_cancel_pending", "{}", {
        ownerKey: "owner",
        sourceMessageKey: "signal:1",
        toolCallIndex: 0,
        nowMs: 1_100,
      });

      expect(result.ok).toBe(true);
      expect(result.directReply).toBe("Jasne, anulowane.");
      const snapshot = contexts.get("owner", 1_200);
      expect(snapshot.pendingAction).toBeUndefined();
      expect(snapshot.lastEntity?.id).toBe("reminder-1");
    } finally {
      database.close();
    }
  });
});
