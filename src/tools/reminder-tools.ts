import { z } from "zod";
import type { ConversationContextRepository } from "../context/repository";
import type { ReminderRepository } from "../reminders/repository";
import type { ToolRegistration } from "./registry";

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const zonedDateTimeSchema = z
  .string()
  .refine(
    (value) =>
      !Number.isNaN(Date.parse(value)) &&
      /T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value),
    "Expected an ISO 8601 date-time with an explicit UTC offset",
  );

const scheduleSchema = z
  .object({
    title: z.string().trim().min(1).nullable(),
    date: dateSchema.nullable(),
    time: timeSchema.nullable(),
    scheduledAt: zonedDateTimeSchema.nullable(),
  })
  .strict();

const updateSchema = z
  .object({
    reminderId: z.string().uuid().nullable(),
    date: dateSchema.nullable(),
    time: timeSchema.nullable(),
    scheduledAt: zonedDateTimeSchema.nullable(),
  })
  .strict();

const listSchema = z
  .object({
    from: zonedDateTimeSchema.nullable(),
    to: zonedDateTimeSchema.nullable(),
    limit: z.number().int().min(1).max(20).default(10),
  })
  .strict();

function missingForSchedule(input: z.infer<typeof scheduleSchema>): string[] {
  const missing: string[] = [];
  if (!input.title) missing.push("title");
  if (!input.date) missing.push("date");
  if (!input.time) missing.push("time");
  return missing;
}

function clarificationQuestion(missing: string[]): string {
  if (missing.includes("title")) return "O czym mam przypomnieć?";
  if (missing.includes("date")) return "Którego dnia mam przypomnieć?";
  if (missing.includes("time")) return "O której mam przypomnieć?";
  return "Jakich informacji brakuje do przypomnienia?";
}

function validateCompleteSchedule(
  date: string,
  time: string,
  scheduledAt: string | null,
  nowMs: number,
): { scheduledAtMs: number } | { error: string } {
  if (!scheduledAt) {
    return { error: "scheduledAt is required once date and time are complete." };
  }
  if (!scheduledAt.startsWith(`${date}T${time}`)) {
    return { error: "scheduledAt must represent the same local date and time as date/time." };
  }
  const scheduledAtMs = Date.parse(scheduledAt);
  if (!Number.isFinite(scheduledAtMs)) return { error: "scheduledAt is invalid." };
  if (scheduledAtMs <= nowMs) return { error: "The reminder must be scheduled in the future." };
  return { scheduledAtMs };
}

export function createReminderTools(
  reminders: ReminderRepository,
  contexts: ConversationContextRepository,
): ToolRegistration[] {
  return [
    {
      name: "reminder_schedule",
      description:
        "Create a reminder. Use null fields for genuinely missing user information; the application will preserve the draft and ask one focused clarification question.",
      schema: scheduleSchema,
      execute(raw, context) {
        const input = scheduleSchema.parse(raw);
        const missing = missingForSchedule(input);
        if (missing.length > 0) {
          contexts.setPending(
            context.ownerKey,
            {
              tool: "reminder_schedule",
              arguments: input,
              missingInformation: missing,
            },
            context.nowMs,
          );
          return {
            ok: true,
            data: { status: "needs_clarification", missingInformation: missing },
            directReply: clarificationQuestion(missing),
          };
        }

        const complete = validateCompleteSchedule(
          input.date as string,
          input.time as string,
          input.scheduledAt,
          context.nowMs,
        );
        if ("error" in complete) {
          return { ok: false, error: { code: "INVALID_SCHEDULE", message: complete.error } };
        }

        const reminder = reminders.create({
          title: input.title as string,
          scheduledAtMs: complete.scheduledAtMs,
          sourceKey: `${context.sourceMessageKey}:reminder:${context.toolCallIndex}`,
        });
        contexts.clearPending(context.ownerKey, context.nowMs);
        contexts.setLastEntity(
          context.ownerKey,
          {
            type: "reminder",
            id: reminder.id,
            action: "created",
            data: {
              title: reminder.title,
              date: input.date,
              time: input.time,
              scheduledAt: input.scheduledAt,
            },
          },
          context.nowMs,
        );

        return {
          ok: true,
          data: {
            status: "created",
            reminder: {
              id: reminder.id,
              title: reminder.title,
              scheduledAt: input.scheduledAt,
            },
          },
          directReply: `Gotowe. Przypomnę ${input.date} o ${input.time}: ${reminder.title}.`,
        };
      },
    },
    {
      name: "reminder_update",
      description:
        "Change the time/date of an existing pending reminder. For a short correction, use the recent reminder from conversation context. Never invent a reminder id.",
      schema: updateSchema,
      execute(raw, context) {
        const input = updateSchema.parse(raw);
        const snapshot = contexts.get(context.ownerKey, context.nowMs);
        const reminderId =
          input.reminderId ??
          (snapshot.lastEntity?.type === "reminder" ? snapshot.lastEntity.id : undefined);
        if (!reminderId) {
          return {
            ok: false,
            error: { code: "NO_REMINDER_CONTEXT", message: "No recent reminder is available to update." },
          };
        }

        const missing: string[] = [];
        if (!input.date) missing.push("date");
        if (!input.time) missing.push("time");
        if (missing.length > 0) {
          contexts.setPending(
            context.ownerKey,
            {
              tool: "reminder_update",
              arguments: { ...input, reminderId },
              missingInformation: missing,
            },
            context.nowMs,
          );
          return {
            ok: true,
            data: { status: "needs_clarification", missingInformation: missing },
            directReply: clarificationQuestion(missing),
          };
        }

        const complete = validateCompleteSchedule(
          input.date as string,
          input.time as string,
          input.scheduledAt,
          context.nowMs,
        );
        if ("error" in complete) {
          return { ok: false, error: { code: "INVALID_SCHEDULE", message: complete.error } };
        }

        const updated = reminders.updateSchedule(reminderId, complete.scheduledAtMs);
        if (!updated) {
          return {
            ok: false,
            error: {
              code: "REMINDER_NOT_UPDATABLE",
              message: "The reminder does not exist or is no longer pending.",
            },
          };
        }

        contexts.clearPending(context.ownerKey, context.nowMs);
        contexts.setLastEntity(
          context.ownerKey,
          {
            type: "reminder",
            id: updated.id,
            action: "updated",
            data: {
              title: updated.title,
              date: input.date,
              time: input.time,
              scheduledAt: input.scheduledAt,
            },
          },
          context.nowMs,
        );
        return {
          ok: true,
          data: {
            status: "updated",
            reminder: { id: updated.id, title: updated.title, scheduledAt: input.scheduledAt },
          },
          directReply: `Zmienione. Przypomnę ${input.date} o ${input.time}: ${updated.title}.`,
        };
      },
    },
    {
      name: "reminder_list",
      description: "List pending reminders in a requested time range.",
      schema: listSchema,
      execute(raw, context) {
        const input = listSchema.parse(raw);
        const startMs = input.from ? Date.parse(input.from) : context.nowMs;
        const endMs = input.to ? Date.parse(input.to) : startMs + 7 * 86_400_000;
        if (endMs <= startMs) {
          return {
            ok: false,
            error: { code: "INVALID_RANGE", message: "The end of the range must be after the start." },
          };
        }

        const rows = reminders.listBetween(startMs, endMs, input.limit);
        if (rows.length === 0) {
          return {
            ok: true,
            data: { reminders: [] },
            directReply: "Nie masz zaplanowanych przypomnień w tym okresie.",
          };
        }
        return {
          ok: true,
          data: {
            reminders: rows.map((row) => ({
              id: row.id,
              title: row.title,
              scheduledAt: new Date(row.scheduledAtMs).toISOString(),
            })),
          },
        };
      },
    },
  ];
}
