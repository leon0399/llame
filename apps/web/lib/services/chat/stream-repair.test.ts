// @vitest-environment jsdom
// Headless hook: the repair episode's timers and attempt counting are the
// regression surface (#1284), and they need React's effect scheduling.

import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

import { useStreamRepair, type StreamInterruption } from "./stream-repair";

type RepairProps = Parameters<typeof useStreamRepair>[0];

function repairProps(overrides: Partial<RepairProps> = {}): RepairProps {
  return {
    attach: vi.fn(),
    interruption: null,
    currentRunId: "run-1",
    healthy: false,
    onAttempt: vi.fn(),
    ...overrides,
  };
}

function renderRepair(initialProps: RepairProps) {
  return renderHook((props: RepairProps) => useStreamRepair(props), {
    initialProps,
  });
}

describe("useStreamRepair", () => {
  it("attaches immediately for the first interruption of a Run", () => {
    const props = repairProps({
      interruption: { runId: "run-1", seq: 1 },
    });
    renderRepair(props);

    expect(props.attach).toHaveBeenCalledTimes(1);
    expect(props.onAttempt).toHaveBeenCalledTimes(1);
  });

  it("leaves the stream alone while no interruption is reported", () => {
    const props = repairProps();
    renderRepair(props);

    expect(props.attach).not.toHaveBeenCalled();
  });

  it("ignores a re-render while the same interruption is still current", () => {
    const props = repairProps({
      interruption: { runId: "run-1", seq: 1 },
    });
    const { rerender } = renderRepair(props);
    expect(props.attach).toHaveBeenCalledTimes(1);

    // A rebuilt transport (a chatId change rebuilds this callback) re-runs the
    // effect; one interruption must not spend a second attempt, or a re-render
    // could schedule a redundant attach.
    const next: RepairProps = { ...props, attach: vi.fn() };
    rerender(next);
    expect(next.attach).not.toHaveBeenCalled();
    expect(props.onAttempt).toHaveBeenCalledTimes(1);
  });

  it("backs off with equal jitter between consecutive failures, then gives up", () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    try {
      const props = repairProps();
      const { rerender } = renderRepair(props);
      let current = props;
      const interrupt = () => {
        current = {
          ...current,
          interruption: {
            runId: "run-1",
            seq: (current.interruption?.seq ?? 0) + 1,
          } satisfies StreamInterruption,
        };
        rerender(current);
      };

      // The first attempt is immediate; a later failure waits its attempt's
      // equal-jitter delay (halves of the 1 s, 2 s, 4 s ceilings).
      interrupt();
      expect(props.attach).toHaveBeenCalledTimes(1);

      interrupt();
      expect(props.attach).toHaveBeenCalledTimes(1);
      act(() => void vi.advanceTimersByTime(500));
      expect(props.attach).toHaveBeenCalledTimes(2);

      interrupt();
      act(() => void vi.advanceTimersByTime(1000));
      expect(props.attach).toHaveBeenCalledTimes(3);

      interrupt();
      act(() => void vi.advanceTimersByTime(2000));
      expect(props.attach).toHaveBeenCalledTimes(4);

      interrupt();
      act(() => void vi.advanceTimersByTime(4000));
      expect(props.attach).toHaveBeenCalledTimes(5);

      // Fifth attempt spent: the durable path owns the Run now, and waiting
      // longer produces nothing.
      interrupt();
      act(() => void vi.advanceTimersByTime(600_000));
      expect(props.attach).toHaveBeenCalledTimes(5);
    } finally {
      vi.useRealTimers();
      vi.restoreAllMocks();
    }
  });

  it("replaces a pending retry instead of stacking a second one", () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    try {
      const props = repairProps({
        interruption: { runId: "run-1", seq: 1 },
      });
      const { rerender } = renderRepair(props);
      expect(props.attach).toHaveBeenCalledTimes(1);

      // Attempt 2 waits 500 ms; a third interruption cancels that timer and
      // waits its own 1 s.
      rerender({ ...props, interruption: { runId: "run-1", seq: 2 } });
      rerender({ ...props, interruption: { runId: "run-1", seq: 3 } });
      act(() => void vi.advanceTimersByTime(500));
      expect(props.attach).toHaveBeenCalledTimes(1);
      act(() => void vi.advanceTimersByTime(500));
      expect(props.attach).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
      vi.restoreAllMocks();
    }
  });

  it("drops a pending retry once another run takes over the transcript", () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    try {
      const props = repairProps({ currentRunId: "run-1" });
      const { rerender } = renderRepair(props);
      let current: RepairProps = props;
      const update = (changes: Partial<RepairProps>) => {
        current = { ...current, ...changes };
        rerender(current);
      };

      update({ interruption: { runId: "run-1", seq: 1 } }); // attempt 1: immediate
      update({ interruption: { runId: "run-1", seq: 2 } }); // attempt 2: waits 500 ms
      expect(props.attach).toHaveBeenCalledTimes(1);

      // The user sends again: the transcript now streams a different Run, so the
      // scheduled retry must not open a second stream beside that send.
      update({ currentRunId: "run-2" });
      act(() => void vi.advanceTimersByTime(60_000));

      expect(props.attach).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
      vi.restoreAllMocks();
    }
  });

  it("counts failures from zero once a stream is flowing again", () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    try {
      const props = repairProps({
        interruption: { runId: "run-1", seq: 1 },
      });
      const { rerender } = renderRepair(props);
      rerender({ ...props, interruption: { runId: "run-1", seq: 2 } });
      act(() => void vi.advanceTimersByTime(500));
      expect(props.attach).toHaveBeenCalledTimes(2);

      // The re-attach worked: this Run's stream delivers events.
      rerender({ ...props, healthy: true });

      // Hours later the same Run is interrupted again, and the first attempt
      // is immediate again rather than a 1 s wait.
      rerender({
        ...props,
        healthy: false,
        interruption: { runId: "run-1", seq: 3 },
      });
      expect(props.attach).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
      vi.restoreAllMocks();
    }
  });

  it("drops a pending retry when the chat unmounts", () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    try {
      const props = repairProps({
        interruption: { runId: "run-1", seq: 1 },
      });
      const { rerender, unmount } = renderRepair(props);
      rerender({ ...props, interruption: { runId: "run-1", seq: 2 } });

      unmount();
      act(() => void vi.advanceTimersByTime(60_000));
      expect(props.attach).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
      vi.restoreAllMocks();
    }
  });
});
