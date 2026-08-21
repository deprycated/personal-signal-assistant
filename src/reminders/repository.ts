import { and, asc, eq, gte, lt, lte, sql } from "drizzle-orm";
import type { AppDatabase } from "../db/database";
import { auditLog, reminders, type ReminderRow } from "../db/schema";

export type CreateReminderInput = {
  title: string;
  scheduledAtMs: number;
  eventAtMs?: number | null;
  leadMinutes?: number | null;
  sourceKey?: string;
};

export type UpdateReminderTimingInput = {
  scheduledAtMs: number;
  eventAtMs?: number | null;
  leadMinutes?: number | null;
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
        eventAtMs: input.eventAtMs ?? null,
        scheduledAtMs: input.scheduledAtMs,
        leadMinutes: input.leadMinutes ?? null,
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
      this.audit("reminder.created", "reminder", created.id, {
        eventAtMs: created.eventAtMs,
        scheduledAtMs: created.scheduledAtMs,
        leadMinutes: created.leadMinutes,
      });
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
    const occurrenceAt = sql<number>`coalesce(${reminders.eventAtMs}, ${reminders.scheduledAtMs})`;
    return this.database.db
      .select()
      .from(reminders)
      .where(
        and(
          eq(reminders.status, "pending"),
          gte(occurrenceAt, startMs),
          lt(occurrenceAt, endMs),
        ),
      )
      .orderBy(asc(occurrenceAt))
      .limit(limit)
      .all();
  }

  updateTiming(id: string, input: UpdateReminderTimingInput): ReminderRow | undefined {
    const now = Date.now();
    const result = this.database.db
      .update(reminders)
      .set({
        eventAtMs: input.eventAtMs ?? null,
        scheduledAtMs: input.scheduledAtMs,
        leadMinutes: input.leadMinutes ?? null,
        nextAttemptAtMs: input.scheduledAtMs,
        status: "pending",
        claimedAtMs: null,
        updatedAtMs: now,
      })
      .where(and(eq(reminders.id, id), eq(reminders.status, "pending")))
      .run();

    if (result.changes !== 1) return undefined;
    this.audit("reminder.updated", "reminder", id, {
      eventAtMs: input.eventAtMs ?? null,
      scheduledAtMs: input.scheduledAtMs,
      leadMinutes: input.leadMinutes ?? null,
    });
    return this.getById(id);
  }

  updateSchedule(id: string, scheduledAtMs: number): ReminderRow | undefined {
    const current = this.getById(id);
    if (!current) return undefined;
    return this.updateTiming(id, {
      scheduledAtMs,
      eventAtMs: current.eventAtMs,
      leadMinutes: current.leadMinutes,
    });
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

  recoverStaleClaims(nowMs = Date.now(), staleAfterMs = 2 * 60_000): number {
    const result = this.database.db
      .update(reminders)
      .set({
        status: "pending",
        claimedAtMs: null,
        nextAttemptAtMs: nowMs,
        updatedAtMs: nowMs,
      })
      .where(
        and(
          eq(reminders.status, "sending"),
          lte(reminders.claimedAtMs, nowMs - staleAfterMs),
        ),
      )
      .run();

    if (result.changes > 0) {
      this.audit("reminder.stale_claims_recovered", "scheduler", null, {
        count: result.changes,
        staleAfterMs,
      });
    }
    return result.changes;
  }

  markSent(id: string, sentAtMs = Date.now()): void {
    const result = this.database.db
      .update(reminders)
      .set({ status: "sent", sentAtMs, claimedAtMs: null, updatedAtMs: sentAtMs })
      .where(and(eq(reminders.id, id), eq(reminders.status, "sending")))
      .run();
    if (result.changes === 1) this.audit("reminder.sent", "reminder", id, { sentAtMs });
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

    this.audit(
      permanentlyFailed ? "reminder.failed" : "reminder.retry_scheduled",
      "reminder",
      id,
      {
        attempts,
        retryDelayMs: permanentlyFailed ? null : retryDelayMs,
      },
    );
  }

  private audit(
    eventType: string,
    entityType: string,
    entityId: string | null,
    details: Record<string, unknown>,
  ): void {
    this.database.db
      .insert(auditLog)
      .values({
        eventType,
        entityType,
        entityId,
        detailsJson: JSON.stringify(details),
        createdAtMs: Date.now(),
      })
      .run();
  }
}
