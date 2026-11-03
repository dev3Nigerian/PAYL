import { describe, expect, it } from "vitest";
import { money, workerState } from "../app/backroom/data";

describe("backroom financial displays and health", () => {
  it("preserves minor-unit precision beyond Number's safe integer range", () => {
    expect(money("9007199254740993", "USD")).toBe("USD 90,071,992,547,409.93");
    expect(money("-12646", "USD")).toBe("−USD 126.46");
    expect(money("12345", "JPY")).toBe("JPY 12,345");
    expect(money(null)).toBe("—");
    expect(money("garbage")).toBe("—");
  });
  it("never shows a missing or stale worker as healthy", () => {
    const now = Date.now();
    expect(workerState(null, now).tone).toBe("warning");
    expect(workerState({ status: "ok", last_attempt_at: new Date(now - 120_000).toISOString(), last_success_at: null }, now).label).toBe("Heartbeat overdue");
    expect(workerState({ status: "failed", last_attempt_at: new Date(now).toISOString(), last_success_at: null }, now).tone).toBe("danger");
    expect(workerState({ status: "ok", last_attempt_at: new Date(now - 15_000).toISOString(), last_success_at: new Date(now - 15_000).toISOString() }, now).label).toBe("Running");
  });
});
