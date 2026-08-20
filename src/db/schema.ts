import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export type ReminderStatus = "pending" | "sending" | "sent" | "failed";

export const reminders = sqliteTable(
  "reminders",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    scheduledAtMs: integer("scheduled_at_ms").notNull(),
    nextAttemptAtMs: integer("next_attempt_at_ms").notNull(),
    status: text("status").$type<ReminderStatus>().notNull().default("pending"),
    sourceKey: text("source_key"),
    deliveryAttempts: integer("delivery_attempts").notNull().default(0),
    claimedAtMs: integer("claimed_at_ms"),
    sentAtMs: integer("sent_at_ms"),
    createdAtMs: integer("created_at_ms").notNull(),
    updatedAtMs: integer("updated_at_ms").notNull(),
  },
  (table) => [uniqueIndex("reminders_source_key_unique").on(table.sourceKey)],
);

export const auditLog = sqliteTable("audit_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  eventType: text("event_type").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id"),
  detailsJson: text("details_json").notNull().default("{}"),
  createdAtMs: integer("created_at_ms").notNull(),
});

export type ReminderRow = typeof reminders.$inferSelect;
export type NewReminderRow = typeof reminders.$inferInsert;
