import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { ToolPolicy, ToolRegistry } from "../tools/registry";
import { OpenRouterAgentClient } from "./agent";

describe("OpenRouterAgentClient", () => {
  test("executes a native tool call and feeds its result back to the model", async () => {
    const registry = new ToolRegistry(
      [
        {
          name: "reminder_list",
          description: "List reminders",
          schema: z.object({ limit: z.number().int() }).strict(),
          execute: () => ({ ok: true, data: { reminders: [{ title: "dentysta" }] } }),
        },
      ],
      new ToolPolicy(["reminder_list"]),
    );

    let calls = 0;
    const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      calls += 1;
      const body = JSON.parse(String(init?.body));
      expect(body.response_format).toBeUndefined();
      expect(body.tools[0].function.name).toBe("reminder_list");
      expect(body.tools[0].function.parameters.$schema).toBeUndefined();

      if (calls === 1) {
        const system = body.messages[0].content as string;
        expect(system).toContain("pendingAction");
        expect(system).toContain("Current local date: 2026-08-20");
        expect(system).toContain("Current local time: 20:00");
        return Response.json({
          choices: [
            {
              message: {
                role: "assistant",
                content: null,
                tool_calls: [
                  {
                    id: "call-1",
                    type: "function",
                    function: { name: "reminder_list", arguments: JSON.stringify({ limit: 10 }) },
                  },
                ],
              },
            },
          ],
        });
      }

      const toolMessage = body.messages.at(-1);
      expect(toolMessage.role).toBe("tool");
      expect(toolMessage.tool_call_id).toBe("call-1");
      expect(JSON.parse(toolMessage.content).data.reminders[0].title).toBe("dentysta");
      return Response.json({
        choices: [{ message: { role: "assistant", content: "Masz przypomnienie: dentysta." } }],
      });
    }) as typeof fetch;

    const agent = new OpenRouterAgentClient(
      { apiKey: "test", model: "deepseek/test", timezone: "Europe/Warsaw" },
      registry,
      fetchImpl,
    );
    const response = await agent.respond({
      text: "co mam ustawione?",
      ownerKey: "owner",
      sourceMessageKey: "signal:1",
      conversation: {
        pendingAction: {
          tool: "reminder_schedule",
          arguments: { title: "dentysta", time: null },
          missingInformation: ["time"],
        },
      },
      now: new Date("2026-08-20T18:00:00Z"),
    });

    expect(response).toBe("Masz przypomnienie: dentysta.");
    expect(calls).toBe(2);
  });

  test("uses a deterministic direct reply without a second model round", async () => {
    const registry = new ToolRegistry(
      [
        {
          name: "reminder_schedule",
          description: "Schedule reminder",
          schema: z.object({ time: z.string().nullable() }).strict(),
          execute: () => ({
            ok: true,
            data: { status: "needs_clarification" },
            directReply: "O której?",
          }),
        },
      ],
      new ToolPolicy(["reminder_schedule"]),
    );

    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return Response.json({
        choices: [
          {
            message: {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "call-1",
                  type: "function",
                  function: { name: "reminder_schedule", arguments: JSON.stringify({ time: null }) },
                },
              ],
            },
          },
        ],
      });
    }) as typeof fetch;

    const agent = new OpenRouterAgentClient(
      { apiKey: "test", model: "deepseek/test", timezone: "Europe/Warsaw" },
      registry,
      fetchImpl,
    );
    const response = await agent.respond({
      text: "dentysta jutro o",
      ownerKey: "owner",
      sourceMessageKey: "signal:1",
      conversation: {},
      now: new Date("2026-08-20T18:00:00Z"),
    });

    expect(response).toBe("O której?");
    expect(calls).toBe(1);
  });
});
