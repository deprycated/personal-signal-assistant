import { logger } from "../logger";
import type { SignalClient } from "../signal/client";
import type { ReminderRepository } from "./repository";

export class ReminderScheduler {
  private running = false;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly reminders: ReminderRepository,
    private readonly signal: SignalClient,
    private readonly ownerNumber: string,
    private readonly pollMs: number,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    void this.loop();
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  async tick(nowMs = Date.now()): Promise<void> {
    const due = this.reminders.claimDue(nowMs);
    for (const reminder of due) {
      try {
        await this.signal.sendMessage(this.ownerNumber, `Przypomnienie: ${reminder.title}`);
        this.reminders.markSent(reminder.id, Date.now());
        logger.info("Reminder delivered", { reminderId: reminder.id });
      } catch (error) {
        this.reminders.markDeliveryFailure(reminder.id, Date.now());
        logger.error("Reminder delivery failed", {
          reminderId: reminder.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  private async loop(): Promise<void> {
    try {
      await this.tick();
    } catch (error) {
      logger.error("Reminder scheduler tick failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      if (this.running) {
        this.timer = setTimeout(() => void this.loop(), this.pollMs);
      }
    }
  }
}
