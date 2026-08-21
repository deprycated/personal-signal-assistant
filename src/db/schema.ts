import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export type ReminderStatus = "pending" | "sending" | "sent" | "failed";
export type ConversationTurnRole = "user" | "assistant" | "tool";

export const reminders = sqliteTable(
  "reminders",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    eventAtMs: integer("event_at_ms"),
    scheduledAtMs: integer("scheduled_at_ms").notNull(),
    leadMinutes: integer("lead_minutes"),
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

export const conversationTurns = sqliteTable(
  "conversation_turns",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    ownerKey: text("owner_key").notNull(),
    role: text("role").$type<ConversationTurnRole>().notNull(),
    content: text("content").notNull(),
    messageJson: text("message_json"),
    createdAtMs: integer("created_at_ms").notNull(),
  },
  (table) => [index("conversation_turns_owner_created_idx").on(table.ownerKey, table.createdAtMs)],
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
