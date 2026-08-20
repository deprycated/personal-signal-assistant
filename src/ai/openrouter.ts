import { assistantIntentJsonSchema, assistantIntentSchema, type AssistantIntent } from "./intent";

export type OpenRouterConfig = {
  apiKey: string;
  model: string;
  timezone: string;
};

type FetchLike = typeof fetch;

const SYSTEM_PROMPT = `You are the intent layer for a private personal assistant used through Signal.
Interpret natural Polish messages, including typos, abbreviations, omitted punctuation, and varying word order.
Do not require commands, prefixes, slash syntax, or special characters.
Return exactly one structured intent matching the supplied schema.
Never invent material missing information. If an action needs a missing detail, use intent "ambiguous", list what is missing in missingInformation, and put one short Polish clarification question in reply.
For ordinary conversation use intent "reply" and put the natural Polish answer in reply.
For action intents, extract only information actually present or safely derivable from the user's wording and current time.
Dates and times must be interpreted in the provided timezone. Use ISO 8601 for datetime when enough information is available.
The intent layer never executes actions itself.`;

export class OpenRouterIntentClient {
  constructor(
    private readonly config: OpenRouterConfig,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  async interpret(text: string, now = new Date()): Promise<AssistantIntent> {
    const response = await this.fetchImpl("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.config.model,
        temperature: 0,
        provider: { require_parameters: true },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: `Current time: ${now.toISOString()}\nTimezone: ${this.config.timezone}\nMessage: ${text}`,
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "assistant_intent",
            strict: true,
            schema: assistantIntentJsonSchema,
          },
        },
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`OpenRouter request failed (${response.status}): ${body.slice(0, 500)}`);
    }

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string | null } }>;
    };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) throw new Error("OpenRouter returned no structured content");

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new Error("OpenRouter returned invalid JSON content");
    }

    return assistantIntentSchema.parse(parsed);
  }
}
