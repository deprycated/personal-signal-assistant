import { eq } from "drizzle-orm";
import type { AppDatabase } from "../db/database";
import { conversationContext } from "../db/schema";

export type PendingAction = {
  tool: string;
  arguments: Record<string, unknown>;
  missingInformation: string[];
};

export type RecentEntity = {
  type: string;
  id: string;
  action: string;
  data: Record<string, unknown>;
};

export type ConversationSnapshot = {
  pendingAction?: PendingAction;
  lastEntity?: RecentEntity;
};

function parseObject(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function parseStringArray(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export class ConversationContextRepository {
  constructor(private readonly database: AppDatabase) {}

  get(ownerKey: string, nowMs = Date.now()): ConversationSnapshot {
    const row = this.database.db
      .select()
      .from(conversationContext)
      .where(eq(conversationContext.ownerKey, ownerKey))
      .limit(1)
      .get();
    if (!row) return {};

    const snapshot: ConversationSnapshot = {};
    if (row.pendingTool && row.pendingExpiresAtMs && row.pendingExpiresAtMs > nowMs) {
      snapshot.pendingAction = {
        tool: row.pendingTool,
        arguments: parseObject(row.pendingArgumentsJson),
        missingInformation: parseStringArray(row.missingInformationJson),
      };
    }

    if (
      row.lastEntityType &&
      row.lastEntityId &&
      row.lastAction &&
      row.lastEntityExpiresAtMs &&
      row.lastEntityExpiresAtMs > nowMs
    ) {
      snapshot.lastEntity = {
        type: row.lastEntityType,
        id: row.lastEntityId,
        action: row.lastAction,
        data: parseObject(row.lastEntityJson),
      };
    }

    return snapshot;
  }

  setPending(
    ownerKey: string,
    pending: PendingAction,
    nowMs = Date.now(),
    ttlMs = 24 * 60 * 60_000,
  ): void {
    this.database.db
      .insert(conversationContext)
      .values({
        ownerKey,
        pendingTool: pending.tool,
        pendingArgumentsJson: JSON.stringify(pending.arguments),
        missingInformationJson: JSON.stringify(pending.missingInformation),
        pendingExpiresAtMs: nowMs + ttlMs,
        updatedAtMs: nowMs,
      })
      .onConflictDoUpdate({
        target: conversationContext.ownerKey,
        set: {
          pendingTool: pending.tool,
          pendingArgumentsJson: JSON.stringify(pending.arguments),
          missingInformationJson: JSON.stringify(pending.missingInformation),
          pendingExpiresAtMs: nowMs + ttlMs,
          updatedAtMs: nowMs,
        },
      })
      .run();
  }

  clearPending(ownerKey: string, nowMs = Date.now()): void {
    this.database.db
      .update(conversationContext)
      .set({
        pendingTool: null,
        pendingArgumentsJson: null,
        missingInformationJson: null,
        pendingExpiresAtMs: null,
        updatedAtMs: nowMs,
      })
      .where(eq(conversationContext.ownerKey, ownerKey))
      .run();
  }

  setLastEntity(
    ownerKey: string,
    entity: RecentEntity,
    nowMs = Date.now(),
    ttlMs = 6 * 60 * 60_000,
  ): void {
    this.database.db
      .insert(conversationContext)
      .values({
        ownerKey,
        lastEntityType: entity.type,
        lastEntityId: entity.id,
        lastAction: entity.action,
        lastEntityJson: JSON.stringify(entity.data),
        lastEntityExpiresAtMs: nowMs + ttlMs,
        updatedAtMs: nowMs,
      })
      .onConflictDoUpdate({
        target: conversationContext.ownerKey,
        set: {
          lastEntityType: entity.type,
          lastEntityId: entity.id,
          lastAction: entity.action,
          lastEntityJson: JSON.stringify(entity.data),
          lastEntityExpiresAtMs: nowMs + ttlMs,
          updatedAtMs: nowMs,
        },
      })
      .run();
  }
}
