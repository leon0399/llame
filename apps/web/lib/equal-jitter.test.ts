import { describe, expect, it } from "vitest";

import { equalJitterDelayMs, RECONNECT_CEILING_MS } from "./equal-jitter";

describe("equalJitterDelayMs", () => {
  it("backs off exponentially within a jittered half-to-full window, capped at 30 s", () => {
    expect(equalJitterDelayMs(0, () => 0)).toBe(500);
    expect(equalJitterDelayMs(0, () => 1)).toBe(1000);
    expect(equalJitterDelayMs(3, () => 1)).toBe(8000);
    expect(equalJitterDelayMs(20, () => 1)).toBe(30_000);
    expect(equalJitterDelayMs(20, () => 0)).toBe(15_000);
  });

  it("keeps the floor at half the ceiling once the ceiling is capped", () => {
    expect(equalJitterDelayMs(30, () => 0)).toBe(RECONNECT_CEILING_MS / 2);
  });
});
