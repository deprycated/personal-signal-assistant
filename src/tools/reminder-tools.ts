import { z } from "zod";
import type { ConversationContextRepository } from "../context/repository";
import type { ReminderRepository } from "../reminders/repository";
import { addCalendarDays, localDateTimeAt, resolveLocalDateTime } from "../time/zoned";
import type { ToolRegistration } from "./registry";

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

const scheduleSchema = z
  .object({
    title: z.string().trim().min(1).nullable(),
    date: dateSchema.nullable(),
    time: timeSchema.nullable(),
  })
  .strict();

const updateSchema = z
  .object({
    reminderId: z.string().uuid().nullable(),
    date: dateSchema.nullable(),
    time: timeSchema.nullable(),
  })
  .strict();

const listSchema = z
  .object({
    fromDate: dateSchema.nullable(),
    throughDate: dateSchema.nullable(),
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

export function createReminderTools(
  reminders: ReminderRepository,
  contexts: ConversationContextRepository,
  timezone: string,
): ToolRegistration[] {
  return [
    {
      name: "reminder_schedule",
      description:
        "Create a reminder. date is YYYY-MM-DD and time is HH:mm in the configured user timezone. Use null for genuinely missing user information; the application preserves the draft and asks one focused clarification.",
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

        const resolved = resolveLocalDateTime(input.date as string, input.time as string, timezone);
        if (!resolved.ok) {
          return {
            ok: false,
            error: { code: "INVALID_LOCAL_DATETIME", message: resolved.error },
          };
        }
        if (resolved.epochMs <= context.nowMs) {
          return {
            ok: false,
            error: { code: "SCHEDULE_IN_PAST", message: "The reminder must be in the future." },
          };
        }

        const reminder = reminders.create({
          title: input.title as string,
          scheduledAtMs: resolved.epochMs,
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
              date: input.date,
              time: input.time,
            },
          },
          directReply: `Gotowe. Przypomnę ${input.date} o ${input.time}: ${reminder.title}.`,
        };
      },
    },
    {
      name: "reminder_update",
      description:
        "Change the local date/time of an existing pending reminder. For a short correction, use the recent reminder from conversation context. Never invent a reminder id.",
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

        const resolved = resolveLocalDateTime(input.date as string, input.time as string, timezone);
        if (!resolved.ok) {
          return {
            ok: false,
            error: { code: "INVALID_LOCAL_DATETIME", message: resolved.error },
          };
        }
        if (resolved.epochMs <= context.nowMs) {
          return {
            ok: false,
            error: { code: "SCHEDULE_IN_PAST", message: "The reminder must be in the future." },
          };
        }

        const updated = reminders.updateSchedule(reminderId, resolved.epochMs);
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
            },
          },
          context.nowMs,
        );
        return {
          ok: true,
          data: {
            status: "updated",
            reminder: { id: updated.id, title: updated.title, date: input.date, time: input.time },
          },
          directReply: `Zmienione. Przypomnę ${input.date} o ${input.time}: ${updated.title}.`,
        };
      },
    },
    {
      name: "reminder_list",
      description:
        "List pending reminders for an inclusive local calendar-date range. Use YYYY-MM-DD dates in the configured user timezone.",
      schema: listSchema,
      execute(raw, context) {
        const input = listSchema.parse(raw);
        const today = localDateTimeAt(context.nowMs, timezone).date;
        const fromDate = input.fromDate ?? today;
        const throughDate = input.throughDate ?? addCalendarDays(fromDate, 6);
        if (throughDate < fromDate) {
          return {
            ok: false,
            error: { code: "INVALID_RANGE", message: "throughDate must not be before fromDate." },
          };
        }

        const start = resolveLocalDateTime(fromDate, "00:00", timezone);
        const end = resolveLocalDateTime(addCalendarDays(throughDate, 1), "00:00", timezone);
        if (!start.ok || !end.ok) {
          return {
            ok: false,
            error: { code: "INVALID_RANGE", message: "Could not resolve the requested date range." },
          };
        }

        const rows = reminders.listBetween(start.epochMs, end.epochMs, input.limit);
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
              ...localDateTimeAt(row.scheduledAtMs, timezone),
            })),
          },
        };
      },
    },
  ];
}
