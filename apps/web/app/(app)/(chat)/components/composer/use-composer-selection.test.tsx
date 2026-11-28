// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ModelsResponse } from "@/lib/services/models/queries";
import {
  applicableHold,
  resolveDisplayedEffort,
  resolveDisplayedModel,
} from "@/lib/services/models/selection";
import { useHoldExpiryClock } from "./use-composer-selection";

const data: ModelsResponse = {
  defaultSelector: "@coding",
  models: [
    {
      id: "primary",
      source: "system",
      name: "Primary",
      contextWindowTokens: 128_000,
      input: ["text"],
      reasoning: {
        effortLevels: [{ value: "high", label: "High" }],
        defaultEffort: "high",
        cacheInvalidatedByEffortChange: false,
      },
    },
    {
      id: "held",
      source: "system",
      name: "Held model",
      contextWindowTokens: 128_000,
      input: ["text", "image"],
      reasoning: {
        effortLevels: [{ value: "low", label: "Low" }],
        defaultEffort: "low",
        cacheInvalidatedByEffortChange: false,
      },
    },
  ],
  roles: [
    {
      selector: "@coding",
      candidates: [
        { modelId: "primary", effort: "high", paid: false },
        { modelId: "held", paid: false },
      ],
    },
  ],
};

const selection = {
  selector: "@coding",
  effort: "low",
  hold: {
    selector: "@coding",
    modelId: "held",
    effort: "low",
    revertAt: "2026-11-23T12:00:01.000Z",
  },
};

type HoldProps = { hold: typeof selection.hold | undefined };

afterEach(() => vi.useRealTimers());

describe("useHoldExpiryClock", () => {
  it("re-derives the model and effort at the hold's revertAt", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-23T12:00:00.000Z"));

    const { result } = renderHook(() => {
      const clock = useHoldExpiryClock(selection.hold.revertAt);
      const now = new Date(clock);
      const model = resolveDisplayedModel(selection, data, now);

      return {
        hold: applicableHold(selection, data, now),
        model,
        effort: resolveDisplayedEffort({
          selection,
          model,
          pickedEffort: undefined,
          data,
          now,
        }),
      };
    });

    expect(result.current.model?.name).toBe("Held model");
    expect(result.current.effort).toBe("low");
    expect(result.current.model?.input).toEqual(["text", "image"]);

    act(() => vi.advanceTimersByTime(1000));

    expect(result.current.hold).toBeUndefined();
    expect(result.current.model?.name).toBe("Primary");
    expect(result.current.effort).toBe("high");
    expect(result.current.model?.input).toEqual(["text"]);
  });

  it("does not apply a hold that arrives after it has expired", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-23T12:00:00.000Z"));

    const initialProps: HoldProps = { hold: undefined };

    const { result, rerender } = renderHook(
      ({ hold }: HoldProps) => {
        const displayed = {
          selector: selection.selector,
          effort: selection.effort,
          ...(hold !== undefined && { hold }),
        };

        const now = new Date(useHoldExpiryClock(hold?.revertAt));
        const model = resolveDisplayedModel(displayed, data, now);

        return {
          hold: applicableHold(displayed, data, now),
          model,
        };
      },
      { initialProps },
    );

    expect(result.current.model?.name).toBe("Primary");

    act(() => vi.advanceTimersByTime(2000));
    rerender({ hold: selection.hold });
    // The clock catches up on the next tick, before any later interaction.
    act(() => vi.advanceTimersByTime(0));

    expect(result.current.hold).toBeUndefined();
    expect(result.current.model?.name).toBe("Primary");
  });
});
