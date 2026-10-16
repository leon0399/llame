import { describe, expect, it } from "vitest";

import { equalJitterDelayMs } from "./equal-jitter";

const THIRTY_SECONDS = 30_000;

describe("equalJitterDelayMs", () => {
  it("backs off exponentially within a jittered half-to-full window", () => {
    expect(equalJitterDelayMs(0, THIRTY_SECONDS, () => 0)).toBe(500);
    expect(equalJitterDelayMs(0, THIRTY_SECONDS, () => 1)).toBe(1000);
    expect(equalJitterDelayMs(3, THIRTY_SECONDS, () => 1)).toBe(8000);
    expect(equalJitterDelayMs(20, THIRTY_SECONDS, () => 1)).toBe(30_000);
    expect(equalJitterDelayMs(20, THIRTY_SECONDS, () => 0)).toBe(15_000);
  });

  it("caps at the ceiling the caller passes, not at one of its own", () => {
    expect(equalJitterDelayMs(20, 4000, () => 1)).toBe(4000);
    expect(equalJitterDelayMs(20, 4000, () => 0)).toBe(2000);
  });
});
