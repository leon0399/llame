import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHeartbeat } from "./heartbeat";

const INTERVAL = 100;

function build() {
  const pings: Array<number> = [];
  let clock = 0;
  let lost = false;
  const beat = createHeartbeat({
    intervalMs: INTERVAL,
    misses: 3,
    now: () => clock,
    onLost: () => {
      lost = true;
    },
    sendPing: () => pings.push(clock),
  });
  /** Move the clock one interval at a time, firing each tick at its own time. */
  const advance = (intervals: number): void => {
    for (let step = 0; step < intervals; step += 1) {
      clock += INTERVAL;
      vi.advanceTimersByTime(INTERVAL);
    }
  };
  return { beat, pings, advance, wasLost: () => lost };
}

describe("heartbeat", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("pings every interval and ends the session after three silent ones", () => {
    const { beat, pings, advance, wasLost } = build();
    beat.start();
    advance(2);
    expect(pings).toEqual([100, 200]);
    beat.record();
    advance(2);
    expect(wasLost()).toBe(false);
    advance(1);
    expect(wasLost()).toBe(true);
    expect(pings).toEqual([100, 200, 300, 400]);
  });

  it("keeps one timer across repeated starts and stops pinging when stopped", () => {
    const { beat, pings, advance, wasLost } = build();
    beat.start();
    beat.start();
    advance(2);
    expect(pings).toEqual([100, 200]);
    beat.stop();
    beat.stop();
    advance(10);
    expect(pings).toEqual([100, 200]);
    expect(wasLost()).toBe(false);
  });

  it("restarts cleanly after a stop", () => {
    const { beat, pings, advance } = build();
    beat.start();
    advance(1);
    beat.stop();
    beat.start();
    advance(1);
    expect(pings).toEqual([100, 200]);
  });
});
