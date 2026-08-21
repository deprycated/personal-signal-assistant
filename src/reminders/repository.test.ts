import { describe, expect, test } from "bun:test";
import { createDatabase } from "../db/database";
import { ReminderRepository } from "./repository";

describe("ReminderRepository", () => {
  test("create is idempotent for the same source key", () => {
    const database = createDatabase(":memory:");
    try {
      const repository = new ReminderRepository(database);
      const first = repository.create({
        title: "dentysta",
        scheduledAtMs: 1_800_000_000_000,
        sourceKey: "signal:123:tool:0",
      });
      const second = repository.create({
        title: "ignored duplicate",
        scheduledAtMs: 1_900_000_000_000,
        sourceKey: "signal:123:tool:0",
      });

      expect(second.id).toBe(first.id);
      expect(second.title).toBe("dentysta");
    } finally {
      database.close();
    }
  });

  test("a due reminder can only be claimed once before completion", () => {
    const database = createDatabase(":memory:");
    try {
      const repository = new ReminderRepository(database);
      const reminder = repository.create({ title: "test", scheduledAtMs: 1_000 });

      const firstClaim = repository.claimDue(2_000);
      const secondClaim = repository.claimDue(2_000);

      expect(firstClaim.map((row) => row.id)).toEqual([reminder.id]);
      expect(secondClaim).toEqual([]);

      repository.markSent(reminder.id, 2_100);
      expect(repository.getById(reminder.id)?.status).toBe("sent");
      expect(repository.claimDue(3_000)).toEqual([]);
    } finally {
      database.close();
    }
  });

  test("delivery failures are retried with backoff and eventually fail", () => {
    const database = createDatabase(":memory:");
    try {
      const repository = new ReminderRepository(database);
      const reminder = repository.create({ title: "test", scheduledAtMs: 1_000 });

      let now = 2_000;
      for (let attempt = 1; attempt <= 5; attempt += 1) {
        const [claimed] = repository.claimDue(now);
        expect(claimed?.id).toBe(reminder.id);
        repository.markDeliveryFailure(reminder.id, now);
        const row = repository.getById(reminder.id);
        expect(row?.deliveryAttempts).toBe(attempt);
        if (attempt < 5) {
          expect(row?.status).toBe("pending");
          now = (row?.nextAttemptAtMs ?? now) + 1;
        } else {
          expect(row?.status).toBe("failed");
        }
      }
    } finally {
      database.close();
    }
  });

  test("stale sending claims are recovered after a process crash", () => {
    const database = createDatabase(":memory:");
    try {
      const repository = new ReminderRepository(database);
      const reminder = repository.create({ title: "test", scheduledAtMs: 1_000 });
      expect(repository.claimDue(2_000)[0]?.id).toBe(reminder.id);
      expect(repository.getById(reminder.id)?.status).toBe("sending");

      expect(repository.recoverStaleClaims(4_000, 1_000)).toBe(1);
      expect(repository.getById(reminder.id)?.status).toBe("pending");
      expect(repository.claimDue(4_000)[0]?.id).toBe(reminder.id);
    } finally {
      database.close();
    }
  });
});
