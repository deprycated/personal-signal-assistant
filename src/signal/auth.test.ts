import { describe, expect, test } from "bun:test";
import type { AppConfig } from "../config";
import { authorizeSender } from "./auth";

const baseConfig: AppConfig = {
  port: 3000,
  signalApiUrl: "http://signal:8080",
  signalBotNumber: "+48999999999",
  signalOwnerNumber: "+48123456789",
};

describe("authorizeSender", () => {
  test("allows configured owner number during UUID bootstrap", () => {
    expect(
      authorizeSender(
        { senderNumber: "+48123456789", text: "hello" },
        baseConfig,
      ),
    ).toEqual({ allowed: true, via: "number" });
  });

  test("rejects another number during UUID bootstrap", () => {
    expect(
      authorizeSender(
        { senderNumber: "+48000000000", text: "hello" },
        baseConfig,
      ),
    ).toEqual({ allowed: false, reason: "number_mismatch" });
  });

  test("allows UUID-only sealed sender when owner UUID is configured", () => {
    const config: AppConfig = {
      ...baseConfig,
      signalOwnerUuid: "expected-uuid",
    };

    expect(
      authorizeSender(
        { senderUuid: "expected-uuid", text: "hello" },
        config,
      ),
    ).toEqual({ allowed: true, via: "uuid" });
  });

  test("rejects wrong UUID even if phone number matches", () => {
    const config: AppConfig = {
      ...baseConfig,
      signalOwnerUuid: "expected-uuid",
    };

    expect(
      authorizeSender(
        {
          senderNumber: "+48123456789",
          senderUuid: "wrong-uuid",
          text: "hello",
        },
        config,
      ),
    ).toEqual({ allowed: false, reason: "uuid_mismatch" });
  });

  test("does not fall back to phone number after owner UUID is configured", () => {
    const config: AppConfig = {
      ...baseConfig,
      signalOwnerUuid: "expected-uuid",
    };

    expect(
      authorizeSender(
        { senderNumber: "+48123456789", text: "hello" },
        config,
      ),
    ).toEqual({ allowed: false, reason: "missing_identity" });
  });
});
