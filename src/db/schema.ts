import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export type ReminderStatus = "pending" | "sending" | "sent" | "failed";
export type ConversationTurnRole = "user" | "assistant";

export const reminders = sqliteTable(
  "reminders",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    // Optional occurrence time of the real-world event/appointment.
    eventAtMs: integer("event_at_ms"),
    // Actual time at which the Signal notification is delivered.
    scheduledAtMs: integer("scheduled_at_ms").notNull(),
    // When non-null, scheduledAtMs is relative to eventAtMs by this many minutes.
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

export const conversationContext = sqliteTable("conversation_context", {
  ownerKey: text("owner_key").primaryKey(),
  pendingTool: text("pending_tool"),
  pendingArgumentsJson: text("pending_arguments_json"),
  missingInformationJson: text("missing_information_json"),
  pendingExpiresAtMs: integer("pending_expires_at_ms"),
  lastEntityType: text("last_entity_type"),
  lastEntityId: text("last_entity_id"),
  lastAction: text("last_action"),
  lastEntityJson: text("last_entity_json"),
  lastEntityExpiresAtMs: integer("last_entity_expires_at_ms"),
  updatedAtMs: integer("updated_at_ms").notNull(),
});

export const conversationTurns = sqliteTable(
  "conversation_turns",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    ownerKey: text("owner_key").notNull(),
    role: text("role").$type<ConversationTurnRole>().notNull(),
    content: text("content").notNull(),
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
