import { and, asc, eq, gte, lt, lte } from "drizzle-orm";
import type { AppDatabase } from "../db/database";
import { auditLog, reminders, type ReminderRow } from "../db/schema";

export type CreateReminderInput = {
  title: string;
  scheduledAtMs: number;
  sourceKey?: string;
};

export class ReminderRepository {
  constructor(private readonly database: AppDatabase) {}

  create(input: CreateReminderInput): ReminderRow {
    if (input.sourceKey) {
      const existing = this.getBySourceKey(input.sourceKey);
      if (existing) return existing;
    }

    const now = Date.now();
    const id = crypto.randomUUID();
    this.database.db
      .insert(reminders)
      .values({
        id,
        title: input.title,
        scheduledAtMs: input.scheduledAtMs,
        nextAttemptAtMs: input.scheduledAtMs,
        sourceKey: input.sourceKey ?? null,
        createdAtMs: now,
        updatedAtMs: now,
      })
      .onConflictDoNothing()
      .run();

    const created = input.sourceKey ? this.getBySourceKey(input.sourceKey) : this.getById(id);
    if (!created) throw new Error("Failed to create reminder");

    if (created.id === id) {
      this.audit("reminder.created", created.id, { scheduledAtMs: created.scheduledAtMs });
    }
    return created;
  }

  getById(id: string): ReminderRow | undefined {
    return this.database.db.select().from(reminders).where(eq(reminders.id, id)).limit(1).get();
  }

  getBySourceKey(sourceKey: string): ReminderRow | undefined {
    return this.database.db
      .select()
      .from(reminders)
      .where(eq(reminders.sourceKey, sourceKey))
      .limit(1)
      .get();
  }

  listUpcoming(nowMs = Date.now(), limit = 20): ReminderRow[] {
    return this.listBetween(nowMs, nowMs + 30 * 86_400_000, limit);
  }

  listBetween(startMs: number, endMs: number, limit = 20): ReminderRow[] {
    return this.database.db
      .select()
      .from(reminders)
      .where(
        and(
          eq(reminders.status, "pending"),
          gte(reminders.scheduledAtMs, startMs),
          lt(reminders.scheduledAtMs, endMs),
        ),
      )
      .orderBy(asc(reminders.scheduledAtMs))
      .limit(limit)
      .all();
  }

  updateSchedule(id: string, scheduledAtMs: number): ReminderRow | undefined {
    const now = Date.now();
    const result = this.database.db
      .update(reminders)
      .set({
        scheduledAtMs,
        nextAttemptAtMs: scheduledAtMs,
        status: "pending",
        claimedAtMs: null,
        updatedAtMs: now,
      })
      .where(and(eq(reminders.id, id), eq(reminders.status, "pending")))
      .run();

    if (result.changes !== 1) return undefined;
    this.audit("reminder.updated", id, { scheduledAtMs });
    return this.getById(id);
  }

  claimDue(nowMs = Date.now(), limit = 10): ReminderRow[] {
    const claim = this.database.sqlite.transaction(() => {
      const due = this.database.db
        .select()
        .from(reminders)
        .where(and(eq(reminders.status, "pending"), lte(reminders.nextAttemptAtMs, nowMs)))
        .orderBy(asc(reminders.nextAttemptAtMs))
        .limit(limit)
        .all();

      const claimed: ReminderRow[] = [];
      for (const reminder of due) {
        const result = this.database.db
          .update(reminders)
          .set({ status: "sending", claimedAtMs: nowMs, updatedAtMs: nowMs })
          .where(and(eq(reminders.id, reminder.id), eq(reminders.status, "pending")))
          .run();
        if (result.changes === 1) {
          const row = this.getById(reminder.id);
          if (row) claimed.push(row);
        }
      }
      return claimed;
    });

    return claim();
  }

  markSent(id: string, sentAtMs = Date.now()): void {
    const result = this.database.db
      .update(reminders)
      .set({ status: "sent", sentAtMs, claimedAtMs: null, updatedAtMs: sentAtMs })
      .where(and(eq(reminders.id, id), eq(reminders.status, "sending")))
      .run();
    if (result.changes === 1) this.audit("reminder.sent", id, { sentAtMs });
  }

  markDeliveryFailure(id: string, failedAtMs = Date.now()): void {
    const reminder = this.getById(id);
    if (!reminder || reminder.status !== "sending") return;

    const attempts = reminder.deliveryAttempts + 1;
    const permanentlyFailed = attempts >= 5;
    const retryDelayMs = Math.min(30_000 * 2 ** (attempts - 1), 10 * 60_000);

    this.database.db
      .update(reminders)
      .set({
        status: permanentlyFailed ? "failed" : "pending",
        deliveryAttempts: attempts,
        nextAttemptAtMs: permanentlyFailed ? reminder.nextAttemptAtMs : failedAtMs + retryDelayMs,
        claimedAtMs: null,
        updatedAtMs: failedAtMs,
      })
      .where(and(eq(reminders.id, id), eq(reminders.status, "sending")))
      .run();

    this.audit(permanentlyFailed ? "reminder.failed" : "reminder.retry_scheduled", id, {
      attempts,
      retryDelayMs: permanentlyFailed ? null : retryDelayMs,
    });
  }

  private audit(eventType: string, entityId: string, details: Record<string, unknown>): void {
    this.database.db
      .insert(auditLog)
      .values({
        eventType,
        entityType: "reminder",
        entityId,
        detailsJson: JSON.stringify(details),
        createdAtMs: Date.now(),
      })
      .run();
  }
}
