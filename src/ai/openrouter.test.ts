import { describe, expect, test } from "bun:test";
import { OpenRouterIntentClient } from "./openrouter";

describe("OpenRouterIntentClient", () => {
  test("parses and validates structured output", async () => {
    const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.model).toBe("qwen/qwen3.5-flash-02-23");
      expect(body.response_format.json_schema.strict).toBe(true);
      expect(body.provider.require_parameters).toBe(true);
      expect(body.messages[0].content.toLowerCase()).toContain("json");

      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  intent: "ambiguous",
                  confidence: 0.95,
                  reply: "O której mam przypomnieć?",
                  missingInformation: ["time"],
                  arguments: {
                    title: "dentysta",
                    query: null,
                    datetime: null,
                    date: "2026-08-21",
                    time: null,
                    note: null,
                    target: null,
                  },
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch;

    const client = new OpenRouterIntentClient(
      {
        apiKey: "test-key",
        model: "qwen/qwen3.5-flash-02-23",
        timezone: "Europe/Warsaw",
      },
      fetchImpl,
    );

    const result = await client.interpret("dentysta jutro", new Date("2026-08-20T16:00:00Z"));
    expect(result.intent).toBe("ambiguous");
    expect(result.missingInformation).toEqual(["time"]);
  });

  test("throws on an upstream error", async () => {
    const fetchImpl = (async () => new Response("boom", { status: 503 })) as typeof fetch;
    const client = new OpenRouterIntentClient(
      { apiKey: "test-key", model: "test-model", timezone: "Europe/Warsaw" },
      fetchImpl,
    );

    expect(client.interpret("test")).rejects.toThrow("OpenRouter request failed (503)");
  });
});
