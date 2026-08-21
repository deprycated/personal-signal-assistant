import { z } from "zod";
import type { ReminderRepository } from "../reminders/repository";
import { addCalendarDays, localDateTimeAt, resolveLocalDateTime } from "../time/zoned";
import type { ToolRegistration } from "./registry";

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const reminderKindSchema = z.enum(["event", "standalone"]);
const daypartSchema = z.enum(["morning", "afternoon", "evening"]);

export const DEFAULT_EVENT_REMINDER_LEAD_MINUTES = 30;
const DAYPART_TIMES: Record<z.infer<typeof daypartSchema>, string> = {
  morning: "08:00",
  afternoon: "15:00",
  evening: "19:00",
};

const timingFields = {
  kind: reminderKindSchema,
  eventDate: dateSchema.nullable(),
  eventTime: timeSchema.nullable(),
  reminderDate: dateSchema.nullable(),
  reminderTime: timeSchema.nullable(),
  reminderDaypart: daypartSchema.nullable(),
  minutesBefore: z.number().int().min(0).max(30 * 24 * 60).nullable(),
} as const;

const scheduleSchema = z
  .object({
    title: z.string().trim().min(1).nullable(),
    ...timingFields,
  })
  .strict();

const updateSchema = z
  .object({
    reminderId: z.string().uuid(),
    kind: reminderKindSchema.nullable(),
    eventDate: dateSchema.nullable(),
    eventTime: timeSchema.nullable(),
    reminderDate: dateSchema.nullable(),
    reminderTime: timeSchema.nullable(),
    reminderDaypart: daypartSchema.nullable(),
    minutesBefore: z.number().int().min(0).max(30 * 24 * 60).nullable(),
  })
  .strict();

const listSchema = z
  .object({
    fromDate: dateSchema.nullable(),
    throughDate: dateSchema.nullable(),
    limit: z.number().int().min(1).max(20).default(10),
  })
  .strict();

type ScheduleInput = z.infer<typeof scheduleSchema>;
type TimingInput = Omit<ScheduleInput, "title">;

type TimingResolution =
  | {
      ok: true;
      eventAtMs: number | null;
      scheduledAtMs: number;
      leadMinutes: number | null;
      normalized: TimingInput;
    }
  | { ok: false; code: string; message: string };

function missingForSchedule(input: ScheduleInput): string[] {
  const missing: string[] = [];
  if (!input.title) missing.push("title");

  if (input.kind === "event") {
    if (!input.eventDate) missing.push("eventDate");
    if (!input.eventTime) missing.push("eventTime");
    if (input.reminderDate && !input.reminderTime && !input.reminderDaypart) {
      missing.push("reminderTime");
    }
  } else {
    if (!input.reminderDate) missing.push("reminderDate");
    if (!input.reminderTime && !input.reminderDaypart) missing.push("reminderTime");
  }
  return missing;
}

function clarificationQuestion(missing: string[]): string {
  if (missing.includes("title")) return "O czym mam przypomnieć?";
  if (missing.includes("eventDate")) return "Kiedy jest wydarzenie?";
  if (missing.includes("eventTime")) return "O której jest wydarzenie?";
  if (missing.includes("reminderDate")) return "Którego dnia mam przypomnieć?";
  if (missing.includes("reminderTime")) return "O której mam przypomnieć?";
  return "Jakich informacji brakuje do przypomnienia?";
}

function resolveTiming(input: TimingInput, timezone: string): TimingResolution {
  if (input.reminderTime && input.reminderDaypart) {
    return {
      ok: false,
      code: "CONFLICTING_REMINDER_TIME",
      message: "Use either reminderTime or reminderDaypart, not both.",
    };
  }

  const hasExplicitReminder = Boolean(
    input.reminderDate || input.reminderTime || input.reminderDaypart,
  );
  if (input.minutesBefore !== null && hasExplicitReminder) {
    return {
      ok: false,
      code: "CONFLICTING_REMINDER_TRIGGER",
      message: "Use either minutesBefore or an explicit reminder date/time/daypart.",
    };
  }

  if (input.kind === "standalone") {
    if (input.eventDate || input.eventTime || input.minutesBefore !== null) {
      return {
        ok: false,
        code: "INVALID_STANDALONE_REMINDER",
        message: "A standalone reminder cannot have an event time or minutesBefore.",
      };
    }
    if (!input.reminderDate || (!input.reminderTime && !input.reminderDaypart)) {
      return { ok: false, code: "INCOMPLETE_REMINDER", message: "Reminder time is incomplete." };
    }
    const clockTime = input.reminderDaypart
      ? DAYPART_TIMES[input.reminderDaypart]
      : (input.reminderTime as string);
    const scheduled = resolveLocalDateTime(input.reminderDate, clockTime, timezone);
    if (!scheduled.ok) {
      return { ok: false, code: "INVALID_LOCAL_DATETIME", message: scheduled.error };
    }
    return {
      ok: true,
      eventAtMs: null,
      scheduledAtMs: scheduled.epochMs,
      leadMinutes: null,
      normalized: input,
    };
  }

  if (!input.eventDate || !input.eventTime) {
    return { ok: false, code: "INCOMPLETE_EVENT", message: "Event date/time is incomplete." };
  }
  const event = resolveLocalDateTime(input.eventDate, input.eventTime, timezone);
  if (!event.ok) return { ok: false, code: "INVALID_EVENT_DATETIME", message: event.error };

  let scheduledAtMs: number;
  let leadMinutes: number | null = null;
  let normalized = input;

  if (input.minutesBefore !== null) {
    leadMinutes = input.minutesBefore;
    scheduledAtMs = event.epochMs - leadMinutes * 60_000;
  } else if (hasExplicitReminder) {
    const reminderDate = input.reminderDate ?? input.eventDate;
    const reminderTime = input.reminderDaypart
      ? DAYPART_TIMES[input.reminderDaypart]
      : input.reminderTime;
    if (!reminderTime) {
      return { ok: false, code: "INCOMPLETE_REMINDER", message: "Reminder time is incomplete." };
    }
    const reminder = resolveLocalDateTime(reminderDate, reminderTime, timezone);
    if (!reminder.ok) {
      return { ok: false, code: "INVALID_LOCAL_DATETIME", message: reminder.error };
    }
    scheduledAtMs = reminder.epochMs;
  } else {
    leadMinutes = DEFAULT_EVENT_REMINDER_LEAD_MINUTES;
    scheduledAtMs = event.epochMs - leadMinutes * 60_000;
    normalized = { ...input, minutesBefore: leadMinutes };
  }

  if (scheduledAtMs > event.epochMs) {
    return {
      ok: false,
      code: "REMINDER_AFTER_EVENT",
      message: "An event reminder cannot be scheduled after the event.",
    };
  }

  return {
    ok: true,
    eventAtMs: event.epochMs,
    scheduledAtMs,
    leadMinutes,
    normalized,
  };
}

function currentTiming(
  reminder: { eventAtMs: number | null; scheduledAtMs: number; leadMinutes: number | null },
  timezone: string,
): TimingInput {
  const notification = localDateTimeAt(reminder.scheduledAtMs, timezone);
  if (reminder.eventAtMs === null) {
    return {
      kind: "standalone",
      eventDate: null,
      eventTime: null,
      reminderDate: notification.date,
      reminderTime: notification.time,
      reminderDaypart: null,
      minutesBefore: null,
    };
  }

  const event = localDateTimeAt(reminder.eventAtMs, timezone);
  if (reminder.leadMinutes !== null) {
    return {
      kind: "event",
      eventDate: event.date,
      eventTime: event.time,
      reminderDate: null,
      reminderTime: null,
      reminderDaypart: null,
      minutesBefore: reminder.leadMinutes,
    };
  }

  return {
    kind: "event",
    eventDate: event.date,
    eventTime: event.time,
    reminderDate: notification.date,
    reminderTime: notification.time,
    reminderDaypart: null,
    minutesBefore: null,
  };
}

function directReply(title: string, timing: TimingResolution & { ok: true }, timezone: string): string {
  const reminder = localDateTimeAt(timing.scheduledAtMs, timezone);
  if (timing.eventAtMs === null) {
    return `Gotowe. Przypomnę ${reminder.date} o ${reminder.time}: ${title}.`;
  }
  const event = localDateTimeAt(timing.eventAtMs, timezone);
  return `Gotowe. ${title}: ${event.date} o ${event.time}. Przypomnę ${reminder.date} o ${reminder.time}.`;
}

export function createReminderTools(
  reminders: ReminderRepository,
  timezone: string,
): ToolRegistration[] {
  return [
    {
      name: "reminder_schedule",
      description:
        "Create a reminder. kind=event means eventDate/eventTime describe the real event and notification is separate. Event reminders default to 30 minutes before when no reminder trigger is provided. kind=standalone means reminderDate/reminderTime/daypart is the notification itself. Use null for genuinely missing information so the tool can ask one clarification.",
      schema: scheduleSchema,
      execute(raw, context) {
        const input = scheduleSchema.parse(raw);
        const missing = missingForSchedule(input);
        if (missing.length > 0) {
          return {
            ok: true,
            data: { status: "needs_clarification", missingInformation: missing, draft: input },
            directReply: clarificationQuestion(missing),
          };
        }

        const timing = resolveTiming(input, timezone);
        if (!timing.ok) return { ok: false, error: { code: timing.code, message: timing.message } };
        if (timing.eventAtMs !== null && timing.eventAtMs <= context.nowMs) {
          return { ok: false, error: { code: "EVENT_IN_PAST", message: "The event must be in the future." } };
        }
        if (timing.scheduledAtMs <= context.nowMs) {
          return {
            ok: false,
            error: { code: "REMINDER_IN_PAST", message: "The reminder time must be in the future." },
          };
        }

        const reminder = reminders.create({
          title: input.title as string,
          eventAtMs: timing.eventAtMs,
          scheduledAtMs: timing.scheduledAtMs,
          leadMinutes: timing.leadMinutes,
          sourceKey: `${context.sourceMessageKey}:reminder:${context.toolCallIndex}`,
        });

        return {
          ok: true,
          data: {
            status: "created",
            reminder: {
              id: reminder.id,
              title: reminder.title,
              event: reminder.eventAtMs ? localDateTimeAt(reminder.eventAtMs, timezone) : null,
              notification: localDateTimeAt(reminder.scheduledAtMs, timezone),
              leadMinutes: reminder.leadMinutes,
              rule: timing.normalized,
            },
          },
          directReply: directReply(reminder.title, timing, timezone),
        };
      },
    },
    {
      name: "reminder_update",
      description:
        "Update an existing pending reminder using its real id from prior tool history or reminder_list. Null timing fields mean unchanged. eventDate/eventTime change the real event; reminderDate/reminderTime/reminderDaypart/minutesBefore change notification timing.",
      schema: updateSchema,
      execute(raw, context) {
        const input = updateSchema.parse(raw);
        const current = reminders.getById(input.reminderId);
        if (!current || current.status !== "pending") {
          return {
            ok: false,
            error: {
              code: "REMINDER_NOT_UPDATABLE",
              message: "The reminder does not exist or is no longer pending.",
            },
          };
        }

        const base = currentTiming(current, timezone);
        const notificationChanged =
          input.reminderDate !== null ||
          input.reminderTime !== null ||
          input.reminderDaypart !== null ||
          input.minutesBefore !== null;

        const merged: ScheduleInput = {
          title: current.title,
          kind: input.kind ?? base.kind,
          eventDate: input.eventDate ?? base.eventDate,
          eventTime: input.eventTime ?? base.eventTime,
          reminderDate: notificationChanged ? input.reminderDate : base.reminderDate,
          reminderTime: notificationChanged ? input.reminderTime : base.reminderTime,
          reminderDaypart: notificationChanged ? input.reminderDaypart : base.reminderDaypart,
          minutesBefore: notificationChanged ? input.minutesBefore : base.minutesBefore,
        };

        const missing = missingForSchedule(merged);
        if (missing.length > 0) {
          return {
            ok: true,
            data: { status: "needs_clarification", missingInformation: missing, draft: merged },
            directReply: clarificationQuestion(missing),
          };
        }

        const timing = resolveTiming(merged, timezone);
        if (!timing.ok) return { ok: false, error: { code: timing.code, message: timing.message } };
        if (timing.eventAtMs !== null && timing.eventAtMs <= context.nowMs) {
          return { ok: false, error: { code: "EVENT_IN_PAST", message: "The event must be in the future." } };
        }
        if (timing.scheduledAtMs <= context.nowMs) {
          return { ok: false, error: { code: "REMINDER_IN_PAST", message: "The reminder time must be in the future." } };
        }

        const updated = reminders.updateTiming(input.reminderId, {
          eventAtMs: timing.eventAtMs,
          scheduledAtMs: timing.scheduledAtMs,
          leadMinutes: timing.leadMinutes,
        });
        if (!updated) {
          return {
            ok: false,
            error: {
              code: "REMINDER_NOT_UPDATABLE",
              message: "The reminder does not exist or is no longer pending.",
            },
          };
        }

        const reply = directReply(updated.title, timing, timezone).replace(/^Gotowe\./, "Zmienione.");
        return {
          ok: true,
          data: {
            status: "updated",
            reminder: {
              id: updated.id,
              title: updated.title,
              event: updated.eventAtMs ? localDateTimeAt(updated.eventAtMs, timezone) : null,
              notification: localDateTimeAt(updated.scheduledAtMs, timezone),
              leadMinutes: updated.leadMinutes,
              rule: timing.normalized,
            },
          },
          directReply: reply,
        };
      },
    },
    {
      name: "reminder_list",
      description:
        "List pending reminders for an inclusive local calendar-date range. Event reminders are grouped by event occurrence; standalone reminders by notification time.",
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
              event: row.eventAtMs ? localDateTimeAt(row.eventAtMs, timezone) : null,
              notification: localDateTimeAt(row.scheduledAtMs, timezone),
              leadMinutes: row.leadMinutes,
            })),
          },
        };
      },
    },
  ];
}
