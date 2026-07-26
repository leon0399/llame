import { afterEach, describe, expect, test, vi } from "vitest";

import { COMMAND_EVENT, STATE_EVENT } from "../src/constants.js";
import {
  createRetryingProjection,
  subscribeToVisualState,
} from "../src/manager/channel.js";
import type { VisualRunState } from "../src/shared/results.js";

describe("manager state channel", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test("retries dropped state requests until connected, then stops", () => {
    vi.useFakeTimers();
    const state: VisualRunState = { running: false, results: [] };
    let stateListener: ((nextState: VisualRunState) => void) | undefined;
    let requests = 0;
    const channel = {
      emit: vi.fn((event: string) => {
        if (event !== COMMAND_EVENT) return;
        requests += 1;
        if (requests === 3) stateListener?.(state);
      }),
      on: vi.fn(
        (event: string, listener: (nextState: VisualRunState) => void) => {
          if (event === STATE_EVENT) stateListener = listener;
        },
      ),
      off: vi.fn(),
    };
    const onState = vi.fn();

    const unsubscribe = subscribeToVisualState(channel, onState);
    expect(requests).toBe(1);

    vi.advanceTimersByTime(500);
    expect(requests).toBe(3);
    expect(onState).toHaveBeenCalledWith(state);

    vi.advanceTimersByTime(1_000);
    expect(requests).toBe(3);
    const updated: VisualRunState = { running: true, results: [] };
    stateListener?.(updated);
    expect(onState).toHaveBeenLastCalledWith(updated);

    unsubscribe();
    expect(channel.off).toHaveBeenCalledWith(STATE_EVENT, stateListener);
  });

  test("replays only the latest state when a projection becomes ready", () => {
    vi.useFakeTimers();
    const first: VisualRunState = { running: false, results: [] };
    const latest: VisualRunState = { running: true, results: [] };
    let ready = false;
    const project = vi.fn((state: VisualRunState) => {
      if (!ready) throw new Error("Cannot set state before store is ready");
      expect(state).toBe(latest);
    });
    const projection = createRetryingProjection(
      project,
      (error) =>
        error instanceof Error &&
        error.message.includes("Cannot set state before store is ready"),
    );

    projection.project(first);
    projection.project(latest);
    ready = true;
    vi.advanceTimersByTime(250);

    expect(project.mock.calls.map(([state]) => state)).toEqual([
      first,
      latest,
      latest,
    ]);
    vi.advanceTimersByTime(1_000);
    expect(project).toHaveBeenCalledTimes(3);

    projection.dispose();
  });
});
