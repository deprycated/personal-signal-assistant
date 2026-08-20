import type { AppConfig } from "../config";
import type { IncomingDirectMessage } from "./types";

export type AuthResult =
  | { allowed: true; via: "uuid" | "number" }
  | {
      allowed: false;
      reason: "uuid_mismatch" | "number_mismatch" | "missing_identity";
    };

export function authorizeSender(
  message: IncomingDirectMessage,
  config: AppConfig,
): AuthResult {
  // Once configured, the Signal UUID/ACI is the canonical owner identity.
  // A phone number is no longer required in incoming envelopes (e.g. sealed sender).
  if (config.signalOwnerUuid) {
    if (!message.senderUuid) {
      return { allowed: false, reason: "missing_identity" };
    }

    if (message.senderUuid !== config.signalOwnerUuid) {
      return { allowed: false, reason: "uuid_mismatch" };
    }

    return { allowed: true, via: "uuid" };
  }

  // Bootstrap fallback before SIGNAL_OWNER_UUID is known.
  if (!message.senderNumber) {
    return { allowed: false, reason: "missing_identity" };
  }

  if (message.senderNumber !== config.signalOwnerNumber) {
    return { allowed: false, reason: "number_mismatch" };
  }

  return { allowed: true, via: "number" };
}
