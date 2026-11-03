import type pino from "pino";
import type { PaylService } from "./service.js";

export class LifecycleWorkers {
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  private nextHeartbeatAt = 0;

  constructor(
    private readonly service: PaylService,
    private readonly intervalMs: number,
    private readonly logger: pino.Logger,
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
    this.timer.unref();
    void this.tick();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    let success = false;
    try {
      const expiry = await this.service.processExpirations();
      const outbox = await this.service.processOutbox();
      const payouts = await this.service.reconcilePendingPayouts();
      success = true;
      if (Object.values(expiry).some((value) => value > 0) || Object.values(outbox).some((value) => value > 0) || payouts > 0) {
        this.logger.info({ expiry, outbox, payouts }, "lifecycle workers processed events");
      }
    } catch (error) {
      this.logger.error({ err: error }, "lifecycle worker tick failed");
    } finally {
      if (Date.now() >= this.nextHeartbeatAt) {
        this.nextHeartbeatAt = Date.now() + 30_000;
        try { await this.service.recordLifecycleHeartbeat(success); }
        catch (error) { this.logger.warn({ err: error }, "lifecycle heartbeat unavailable"); }
      }
      this.running = false;
    }
  }
}
