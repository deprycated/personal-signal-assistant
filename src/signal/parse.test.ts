import { describe, expect, test } from "bun:test";
import { parseSignalEvent } from "./parse";

describe("parseSignalEvent", () => {
  test("parses a direct text message with phone number and UUID", () => {
    const result = parseSignalEvent(
      JSON.stringify({
        envelope: {
          source: "+48123456789",
          sourceNumber: "+48123456789",
          sourceUuid: "owner-uuid",
          sourceName: "Owner",
          timestamp: 123,
          dataMessage: {
            timestamp: 123,
            message: "hello",
          },
        },
        account: "+48999999999",
      }),
    );

    expect(result).toEqual({
      kind: "message",
      message: {
        senderNumber: "+48123456789",
        senderUuid: "owner-uuid",
        senderName: "Owner",
        text: "hello",
        timestamp: 123,
      },
    });
  });

  test("treats source UUID as UUID instead of phone number", () => {
    const result = parseSignalEvent(
      JSON.stringify({
        envelope: {
          source: "ff603517-3b21-4274-b31b-b0714a6f5a5f",
          sourceUuid: "ff603517-3b21-4274-b31b-b0714a6f5a5f",
          sourceNumber: null,
          dataMessage: {
            message: "hello sealed sender",
          },
        },
      }),
    );

    expect(result).toEqual({
      kind: "message",
      message: {
        senderUuid: "ff603517-3b21-4274-b31b-b0714a6f5a5f",
        text: "hello sealed sender",
      },
    });
  });

  test("falls back to source when source contains a phone number", () => {
    const result = parseSignalEvent(
      JSON.stringify({
        envelope: {
          source: "+48123456789",
          sourceNumber: null,
          dataMessage: { message: "hello" },
        },
      }),
    );

    expect(result).toEqual({
      kind: "message",
      message: {
        senderNumber: "+48123456789",
        text: "hello",
      },
    });
  });

  test("rejects group messages", () => {
    const result = parseSignalEvent(
      JSON.stringify({
        envelope: {
          source: "+48123456789",
          dataMessage: {
            message: "group message",
            groupInfo: { groupId: "group-id", type: "DELIVER" },
          },
        },
      }),
    );

    expect(result).toEqual({ kind: "group" });
  });

  test("ignores sync messages", () => {
    const result = parseSignalEvent(
      JSON.stringify({
        envelope: {
          source: "+48123456789",
          syncMessage: { sentMessage: { message: "sent by linked device" } },
        },
      }),
    );

    expect(result).toEqual({ kind: "non-message" });
  });

  test("does not accept invalid JSON", () => {
    expect(parseSignalEvent("not-json")).toEqual({ kind: "invalid" });
  });
});
