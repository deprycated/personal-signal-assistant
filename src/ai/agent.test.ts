import { describe, expect, test } from "bun:test";
import { z } from "zod";
import type { ConversationMessage } from "../context/repository";
import { ToolPolicy, ToolRegistry } from "../tools/registry";
import { OpenRouterAgentClient } from "./agent";

describe("OpenRouterAgentClient", () => {
  test("sends the active conversation history before the new user message", async () => {
    const registry = new ToolRegistry([], new ToolPolicy([]));
    const history: ConversationMessage[] = [
      { role: "user", content: "Lekarz jutro o" },
      { role: "assistant", content: "O której godzinie masz wizytę u lekarza?" },
    ];

    const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.messages[1]).toEqual(history[0]);
      expect(body.messages[2]).toEqual(history[1]);
      expect(body.messages[3]).toEqual({ role: "user", content: "13" });
      return Response.json({
        choices: [{ message: { role: "assistant", content: "Rozumiem: lekarz jutro o 13:00." } }],
      });
    }) as typeof fetch;

    const agent = new OpenRouterAgentClient(
      { apiKey: "test", model: "deepseek/test", timezone: "Europe/Warsaw" },
      registry,
      fetchImpl,
    );

    const response = await agent.respond({
      text: "13",
      ownerKey: "owner",
      sourceMessageKey: "signal:2",
      history,
      now: new Date("2026-08-21T08:00:00Z"),
    });

    expect(response.text).toContain("13:00");
    expect(response.messages).toEqual([
      { role: "user", content: "13" },
      { role: "assistant", content: "Rozumiem: lekarz jutro o 13:00." },
    ]);
  });

  test("persists tool calls, tool results and deterministic direct reply as conversation messages", async () => {
    const registry = new ToolRegistry(
      [
        {
          name: "reminder_schedule",
          description: "Schedule reminder",
          schema: z.object({ time: z.string().nullable() }).strict(),
          execute: () => ({
            ok: true,
            data: { status: "needs_clarification", draft: { time: null } },
            directReply: "O której jest wydarzenie?",
          }),
        },
      ],
      new ToolPolicy(["reminder_schedule"]),
    );

    const fetchImpl = (async () =>
      Response.json({
        choices: [
          {
            message: {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "call-1",
                  type: "function",
                  function: {
                    name: "reminder_schedule",
                    arguments: JSON.stringify({ time: null }),
                  },
                },
              ],
            },
          },
        ],
      })) as typeof fetch;

    const agent = new OpenRouterAgentClient(
      { apiKey: "test", model: "deepseek/test", timezone: "Europe/Warsaw" },
      registry,
      fetchImpl,
    );

    const response = await agent.respond({
      text: "lekarz jutro o",
      ownerKey: "owner",
      sourceMessageKey: "signal:1",
      history: [],
      now: new Date("2026-08-21T08:00:00Z"),
    });

    expect(response.text).toBe("O której jest wydarzenie?");
    expect(response.messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "tool",
      "assistant",
    ]);
    expect(response.messages[1]).toMatchObject({
      role: "assistant",
      tool_calls: [{ id: "call-1" }],
    });
    expect(response.messages[2]).toMatchObject({ role: "tool", tool_call_id: "call-1" });
  });
});
