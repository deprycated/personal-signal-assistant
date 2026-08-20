import type { IncomingDirectMessage } from "./signal/types";
import { SignalClient } from "./signal/client";
import { logger } from "./logger";

export class AssistantApp {
  constructor(
    private readonly signal: SignalClient,
    private readonly ownerNumber: string,
  ) {}

  async handleMessage(message: IncomingDirectMessage): Promise<void> {
    logger.info("Authorized Signal message received", {
      timestamp: message.timestamp ?? null,
      textLength: message.text.length,
      senderUuid: message.senderUuid ?? null,
      hasSenderNumber: Boolean(message.senderNumber),
    });

    // Temporary transport-level behavior.
    // Milestone 1 replaces this with OpenRouter structured intent routing.
    const response =
      message.text.toLocaleLowerCase("pl-PL") === "ping"
        ? "pong"
        : `Odebrałem: ${message.text}`;

    // Reply to the explicitly configured owner instead of trusting an identifier
    // copied from an inbound envelope. This also works when sealed sender omits
    // sourceNumber and only sourceUuid/ACI is available.
    await this.signal.sendMessage(this.ownerNumber, response);
  }
}
