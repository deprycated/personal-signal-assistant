import type { IncomingDirectMessage, SignalReceiveEvent } from "./types";

export type ParseResult =
  | { kind: "message"; message: IncomingDirectMessage }
  | { kind: "group" }
  | { kind: "non-message" }
  | { kind: "invalid" };

function looksLikePhoneNumber(value: string | null | undefined): value is string {
  return Boolean(value?.startsWith("+"));
}

export function parseSignalEvent(raw: string): ParseResult {
  let event: SignalReceiveEvent;
  try {
    event = JSON.parse(raw) as SignalReceiveEvent;
  } catch {
    return { kind: "invalid" };
  }

  const envelope = event.envelope;
  if (!envelope) return { kind: "non-message" };

  if (envelope.syncMessage || envelope.receiptMessage || envelope.typingMessage) {
    return { kind: "non-message" };
  }

  const dataMessage = envelope.dataMessage;
  const text = dataMessage?.message?.trim();
  if (!dataMessage || !text) return { kind: "non-message" };
  if (dataMessage.groupInfo?.groupId) return { kind: "group" };

  const senderNumber = looksLikePhoneNumber(envelope.sourceNumber)
    ? envelope.sourceNumber
    : looksLikePhoneNumber(envelope.source)
      ? envelope.source
      : undefined;

  const senderUuid =
    envelope.sourceUuid ??
    (envelope.source && !looksLikePhoneNumber(envelope.source)
      ? envelope.source
      : undefined);

  if (!senderNumber && !senderUuid) return { kind: "invalid" };

  const message: IncomingDirectMessage = { text };
  if (senderNumber) message.senderNumber = senderNumber;
  if (senderUuid) message.senderUuid = senderUuid;
  if (envelope.sourceName) message.senderName = envelope.sourceName;
  if (envelope.timestamp) message.timestamp = envelope.timestamp;

  return { kind: "message", message };
}
