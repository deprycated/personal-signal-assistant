import { z } from "zod";
import type { ConversationContextRepository } from "../context/repository";
import type { ToolRegistration } from "./registry";

const cancelPendingSchema = z.object({}).strict();

export function createContextTools(contexts: ConversationContextRepository): ToolRegistration[] {
  return [
    {
      name: "conversation_cancel_pending",
      description:
        "Cancel the unfinished pending action only when the user explicitly says to cancel, forget, or abandon it.",
      schema: cancelPendingSchema,
      execute(raw, context) {
        cancelPendingSchema.parse(raw);
        const snapshot = contexts.get(context.ownerKey, context.nowMs);
        if (!snapshot.pendingAction) {
          return { ok: true, data: { status: "nothing_pending" }, directReply: "Nie ma nic do anulowania." };
        }
        contexts.clearPending(context.ownerKey, context.nowMs);
        return { ok: true, data: { status: "cancelled" }, directReply: "Jasne, anulowane." };
      },
    },
  ];
}
