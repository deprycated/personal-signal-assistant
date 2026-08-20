import type { IncomingDirectMessage } from "./signal/types";
import { SignalClient } from "./signal/client";
import { logger } from "./logger";
import { OpenRouterIntentClient } from "./ai/openrouter";
import { renderIntentResponse } from "./ai/respond";

export class AssistantApp {
  constructor(
    private readonly signal: SignalClient,
    private readonly intentClient: OpenRouterIntentClient,
    private readonly ownerNumber: string,
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
      const result = await this.intentClient.interpret(message.text);
      logger.info("Signal message interpreted", {
        intent: result.intent,
        confidence: result.confidence,
        missingInformationCount: result.missingInformation.length,
      });
      await this.signal.sendMessage(this.ownerNumber, renderIntentResponse(result));
    } catch (error) {
      logger.error("Failed to interpret authorized Signal message", {
        error: error instanceof Error ? error.message : String(error),
      });
      await this.signal.sendMessage(
        this.ownerNumber,
        "Nie udało mi się teraz zinterpretować wiadomości. Spróbuj ponownie za chwilę.",
      );
    }
  }
}
