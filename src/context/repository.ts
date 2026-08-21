import { desc, eq, lt } from "drizzle-orm";
import type { AppDatabase } from "../db/database";
import { conversationTurns, type ConversationTurnRole } from "../db/schema";

export const CONVERSATION_IDLE_TIMEOUT_MS = 24 * 60 * 60_000;
export const MAX_CONTEXT_MESSAGES = 100;
const HISTORY_RETENTION_MS = 30 * 24 * 60 * 60_000;

export type ConversationToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

export type ConversationMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ConversationToolCall[] }
  | { role: "tool"; tool_call_id: string; name: string; content: string };

function parseStoredMessage(row: {
  role: ConversationTurnRole;
  content: string;
  messageJson: string | null;
}): ConversationMessage | undefined {
  if (row.messageJson) {
    try {
      const parsed = JSON.parse(row.messageJson) as ConversationMessage;
      if (parsed && typeof parsed === "object" && "role" in parsed) return parsed;
    } catch {
      // Fall back to legacy plain-text rows below.
    }
  }

  if (row.role === "user") return { role: "user", content: row.content };
  if (row.role === "assistant") return { role: "assistant", content: row.content };
  return undefined;
}

function legacyContent(message: ConversationMessage): string {
  if (message.role === "tool") return message.content;
  return message.content ?? "";
}

export class ConversationHistoryRepository {
  constructor(private readonly database: AppDatabase) {}

  getHistory(ownerKey: string, nowMs = Date.now()): ConversationMessage[] {
    const rows = this.database.db
      .select({
        id: conversationTurns.id,
        role: conversationTurns.role,
        content: conversationTurns.content,
        messageJson: conversationTurns.messageJson,
        createdAtMs: conversationTurns.createdAtMs,
      })
      .from(conversationTurns)
      .where(eq(conversationTurns.ownerKey, ownerKey))
      .orderBy(desc(conversationTurns.createdAtMs), desc(conversationTurns.id))
      .limit(MAX_CONTEXT_MESSAGES)
      .all()
      .reverse();

    if (rows.length === 0) return [];
    const last = rows.at(-1);
    if (!last || nowMs - last.createdAtMs > CONVERSATION_IDLE_TIMEOUT_MS) return [];

    let sessionStart = 0;
    for (let index = 1; index < rows.length; index += 1) {
      if (rows[index]!.createdAtMs - rows[index - 1]!.createdAtMs > CONVERSATION_IDLE_TIMEOUT_MS) {
        sessionStart = index;
      }
    }

    const messages: ConversationMessage[] = [];
    for (const row of rows.slice(sessionStart)) {
      const parsed = parseStoredMessage(row);
      if (parsed) messages.push(parsed);
    }

    // A capped history must never start with an orphaned tool/assistant fragment.
    const firstUser = messages.findIndex((message) => message.role === "user");
    return firstUser >= 0 ? messages.slice(firstUser) : [];
  }

  append(ownerKey: string, messages: readonly ConversationMessage[], nowMs = Date.now()): void {
    if (messages.length === 0) return;

    const commit = this.database.sqlite.transaction(() => {
      messages.forEach((message, index) => {
        this.database.db
          .insert(conversationTurns)
          .values({
            ownerKey,
            role: message.role,
            content: legacyContent(message),
            messageJson: JSON.stringify(message),
            createdAtMs: nowMs + index,
          })
          .run();
      });

      this.database.db
        .delete(conversationTurns)
        .where(lt(conversationTurns.createdAtMs, nowMs - HISTORY_RETENTION_MS))
        .run();
    });
    commit();
  }
}
