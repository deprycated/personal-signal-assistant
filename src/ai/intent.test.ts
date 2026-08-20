import { describe, expect, test } from "bun:test";
import { assistantIntentSchema } from "./intent";

describe("assistantIntentSchema", () => {
  test("accepts a valid reminder intent", () => {
    const result = assistantIntentSchema.parse({
      intent: "create_reminder",
      confidence: 0.98,
      reply: "Ustawię przypomnienie o dentyście jutro o 17:00.",
      missingInformation: [],
      arguments: {
        title: "dentysta",
        query: null,
        datetime: "2026-08-21T17:00:00+02:00",
        date: "2026-08-21",
        time: "17:00",
        note: null,
        target: null,
      },
    });

    expect(result.intent).toBe("create_reminder");
    expect(result.arguments.time).toBe("17:00");
  });

  test("rejects confidence outside 0..1", () => {
    expect(() =>
      assistantIntentSchema.parse({
        intent: "reply",
        confidence: 2,
        reply: "test",
        missingInformation: [],
        arguments: {
          title: null,
          query: null,
          datetime: null,
          date: null,
          time: null,
          note: null,
          target: null,
        },
      }),
    ).toThrow();
  });
});
