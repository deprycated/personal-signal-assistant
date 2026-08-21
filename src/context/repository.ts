import { and, desc, eq, gte, inArray, lt } from "drizzle-orm";
import type { AppDatabase } from "../db/database";
import { conversationContext, conversationTurns, type ConversationTurnRole } from "../db/schema";

export const RECENT_TURN_LIMIT = 8;
export const RECENT_TURN_TTL_MS = 24 * 60 * 60_000;
const MAX_TURN_CONTENT_LENGTH = 4_000;

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

export type ConversationTurn = {
  role: ConversationTurnRole;
  content: string;
  createdAtMs: number;
};

export type ConversationSnapshot = {
  pendingAction?: PendingAction;
  lastEntity?: RecentEntity;
  recentTurns?: ConversationTurn[];
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

function boundedContent(content: string): string {
  return content.trim().slice(0, MAX_TURN_CONTENT_LENGTH);
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

    const snapshot: ConversationSnapshot = {};
    if (row?.pendingTool && row.pendingExpiresAtMs && row.pendingExpiresAtMs > nowMs) {
      snapshot.pendingAction = {
        tool: row.pendingTool,
        arguments: parseObject(row.pendingArgumentsJson),
        missingInformation: parseStringArray(row.missingInformationJson),
      };
    }

    if (
      row?.lastEntityType &&
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

    const recentTurns = this.database.db
      .select({
        id: conversationTurns.id,
        role: conversationTurns.role,
        content: conversationTurns.content,
        createdAtMs: conversationTurns.createdAtMs,
      })
      .from(conversationTurns)
      .where(
        and(
          eq(conversationTurns.ownerKey, ownerKey),
          gte(conversationTurns.createdAtMs, nowMs - RECENT_TURN_TTL_MS),
        ),
      )
      .orderBy(desc(conversationTurns.createdAtMs), desc(conversationTurns.id))
      .limit(RECENT_TURN_LIMIT)
      .all()
      .reverse()
      .map(({ role, content, createdAtMs }) => ({ role, content, createdAtMs }));

    if (recentTurns.length > 0) snapshot.recentTurns = recentTurns;
    return snapshot;
  }

  appendExchange(
    ownerKey: string,
    userContent: string,
    assistantContent: string,
    nowMs = Date.now(),
  ): void {
    const user = boundedContent(userContent);
    const assistant = boundedContent(assistantContent);
    if (!user || !assistant) return;

    const commit = this.database.sqlite.transaction(() => {
      this.database.db
        .insert(conversationTurns)
        .values({ ownerKey, role: "user", content: user, createdAtMs: nowMs })
        .run();
      this.database.db
        .insert(conversationTurns)
        .values({ ownerKey, role: "assistant", content: assistant, createdAtMs: nowMs + 1 })
        .run();

      this.database.db
        .delete(conversationTurns)
        .where(
          and(
            eq(conversationTurns.ownerKey, ownerKey),
            lt(conversationTurns.createdAtMs, nowMs - RECENT_TURN_TTL_MS),
          ),
        )
        .run();

      const overflow = this.database.db
        .select({ id: conversationTurns.id })
        .from(conversationTurns)
        .where(eq(conversationTurns.ownerKey, ownerKey))
        .orderBy(desc(conversationTurns.createdAtMs), desc(conversationTurns.id))
        .all()
        .slice(RECENT_TURN_LIMIT)
        .map((row) => row.id);

      if (overflow.length > 0) {
        this.database.db.delete(conversationTurns).where(inArray(conversationTurns.id, overflow)).run();
      }
    });
    commit();
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
