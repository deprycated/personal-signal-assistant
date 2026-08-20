export type SignalDataMessage = {
  timestamp?: number;
  message?: string | null;
  groupInfo?: { groupId?: string; type?: string };
};

export type SignalEnvelope = {
  source?: string | null;
  sourceNumber?: string | null;
  sourceUuid?: string | null;
  sourceName?: string | null;
  sourceDevice?: number;
  timestamp?: number;
  dataMessage?: SignalDataMessage;
  syncMessage?: unknown;
  receiptMessage?: unknown;
  typingMessage?: unknown;
};

export type SignalReceiveEvent = {
  envelope?: SignalEnvelope;
  account?: string;
};

export type IncomingDirectMessage = {
  senderNumber?: string;
  senderUuid?: string;
  senderName?: string;
  text: string;
  timestamp?: number;
};
