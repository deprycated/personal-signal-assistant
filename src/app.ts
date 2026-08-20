import { OpenRouterAgentClient } from "./ai/agent";
import type { ConversationContextRepository } from "./context/repository";
import { logger } from "./logger";
import { SignalClient } from "./signal/client";
import type { IncomingDirectMessage } from "./signal/types";

export class AssistantApp {
  constructor(
    private readonly signal: SignalClient,
    private readonly agent: OpenRouterAgentClient,
    private readonly contexts: ConversationContextRepository,
    private readonly ownerNumber: string,
    private readonly ownerKey: string,
  ) {}

  async handleMessage(message: IncomingDirectMessage): Promise<void> {
    logger.info("Authorized Signal message received", {
      timestamp: message.timestamp ?? null,
      textLength: message.text.length,
      senderUuid: message.senderUuid ?? null,
      hasSenderNumber: Boolean(message.senderNumber),
    });

    if (message.text.toLocaleLowerCase("pl-PL") === "ping") {
      await this.signal.sendMessage(this.ownerNumber, "pong");
      return;
    }

    try {
      const conversation = this.contexts.get(this.ownerKey);
      const sourceMessageKey = message.timestamp
        ? `signal:${message.timestamp}`
        : `signal:${crypto.randomUUID()}`;
      const response = await this.agent.respond({
        text: message.text,
        ownerKey: this.ownerKey,
        sourceMessageKey,
        conversation,
      });
      logger.info("Authorized Signal message handled", {
        hadPendingAction: Boolean(conversation.pendingAction),
        hadRecentEntity: Boolean(conversation.lastEntity),
      });
      await this.signal.sendMessage(this.ownerNumber, response);
    } catch (error) {
      logger.error("Failed to handle authorized Signal message", {
        error: error instanceof Error ? error.message : String(error),
      });
      await this.signal.sendMessage(
        this.ownerNumber,
        "Nie udało mi się teraz obsłużyć wiadomości. Spróbuj ponownie za chwilę.",
      );
    }
  }
}
