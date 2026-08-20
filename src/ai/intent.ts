import { z } from "zod";

export const intentNames = [
  "reply",
  "create_note",
  "search_notes",
  "create_reminder",
  "update_reminder",
  "calendar_query",
  "calendar_create",
  "checkpoint_save",
  "checkpoint_resume",
  "plan_now",
  "ambiguous",
] as const;

export const assistantIntentSchema = z.object({
  intent: z.enum(intentNames),
  confidence: z.number().min(0).max(1),
  reply: z.string().nullable(),
  missingInformation: z.array(z.string()),
  arguments: z.object({
    title: z.string().nullable(),
    query: z.string().nullable(),
    datetime: z.string().nullable(),
    date: z.string().nullable(),
    time: z.string().nullable(),
    note: z.string().nullable(),
    target: z.string().nullable(),
  }),
});

export type AssistantIntent = z.infer<typeof assistantIntentSchema>;

export const assistantIntentJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["intent", "confidence", "reply", "missingInformation", "arguments"],
  properties: {
    intent: { type: "string", enum: intentNames },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    reply: { type: ["string", "null"] },
    missingInformation: { type: "array", items: { type: "string" } },
    arguments: {
      type: "object",
      additionalProperties: false,
      required: ["title", "query", "datetime", "date", "time", "note", "target"],
      properties: {
        title: { type: ["string", "null"] },
        query: { type: ["string", "null"] },
        datetime: { type: ["string", "null"] },
        date: { type: ["string", "null"] },
        time: { type: ["string", "null"] },
        note: { type: ["string", "null"] },
        target: { type: ["string", "null"] },
      },
    },
  },
} as const;
