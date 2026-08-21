import { describe, expect, test } from "bun:test";
import { createDatabase } from "../db/database";
import {
  CONVERSATION_IDLE_TIMEOUT_MS,
  ConversationHistoryRepository,
  type ConversationMessage,
} from "./repository";

describe("ConversationHistoryRepository", () => {
  test("keeps the current conversation and resets context after 24 hours of inactivity", () => {
    const database = createDatabase(":memory:");
    try {
      const history = new ConversationHistoryRepository(database);
      const start = 1_000;
      history.append(
        "owner",
        [
          { role: "user", content: "Lekarz jutro o" },
          { role: "assistant", content: "O której godzinie masz wizytę?" },
        ],
        start,
      );

      expect(history.getHistory("owner", start + CONVERSATION_IDLE_TIMEOUT_MS - 1)).toHaveLength(2);
      expect(history.getHistory("owner", start + CONVERSATION_IDLE_TIMEOUT_MS + 10)).toEqual([]);

      history.append(
        "owner",
        [
          { role: "user", content: "Nowa rozmowa" },
          { role: "assistant", content: "Tak?" },
        ],
        start + CONVERSATION_IDLE_TIMEOUT_MS + 20,
      );

      expect(history.getHistory("owner", start + CONVERSATION_IDLE_TIMEOUT_MS + 30)).toEqual([
        { role: "user", content: "Nowa rozmowa" },
        { role: "assistant", content: "Tak?" },
      ]);
    } finally {
      database.close();
    }
  });

  test("round-trips assistant tool calls and tool results", () => {
    const database = createDatabase(":memory:");
    try {
      const history = new ConversationHistoryRepository(database);
      const messages: ConversationMessage[] = [
        { role: "user", content: "lekarz jutro o" },
        {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call-1",
              type: "function",
              function: {
                name: "reminder_schedule",
                arguments: JSON.stringify({ title: "lekarz", eventTime: null }),
              },
            },
          ],
        },
        {
          role: "tool",
          tool_call_id: "call-1",
          name: "reminder_schedule",
          content: JSON.stringify({ ok: true, data: { status: "needs_clarification" } }),
        },
        { role: "assistant", content: "O której jest wydarzenie?" },
      ];

      history.append("owner", messages, 10_000);
      expect(history.getHistory("owner", 11_000)).toEqual(messages);
    } finally {
      database.close();
    }
  });
});
