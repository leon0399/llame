// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

import type { ModelsResponse } from "@/lib/services/models/queries";
import type { PermissionModesResponse } from "@/lib/services/permission-modes/queries";

import {
  resolveLastTurnModelEffort,
  resolveRestoredPermissionMode,
  useChatHistorySync,
} from "./use-chat-engine";

describe("resolveLastTurnModelEffort", () => {
  const data: ModelsResponse = {
    defaultModelId: "model:default",
    models: [
      {
        id: "model:default",
        source: "system",
        name: "Default",
        contextWindowTokens: 400_000,
        input: ["text"],
      },
      {
        id: "model:recorded",
        source: "system",
        name: "Recorded",
        contextWindowTokens: 200_000,
        input: ["text"],
      },
    ],
  };

  it("restores the recorded model when it is still in the catalog", () => {
    const turn = {
      modelId: "model:recorded" as const,
      effort: undefined,
      permissionMode: "bypass" as const,
    };
    expect(resolveLastTurnModelEffort(data, turn)).toEqual({
      modelId: "model:recorded",
      effort: undefined,
    });
  });

  it("falls back to the default model when the recorded one is unavailable", () => {
    const turn = {
      modelId: "model:retired" as const,
      effort: undefined,
      permissionMode: "bypass" as const,
    };
    expect(resolveLastTurnModelEffort(data, turn)).toEqual({
      modelId: "model:default",
      effort: undefined,
    });
  });
});

describe("resolveRestoredPermissionMode", () => {
  const turn = {
    modelId: "system:openai:gpt-5.4-mini" as const,
    effort: undefined,
    permissionMode: "bypass" as const,
  };

  it("restores bypass only when the operator still lists it", () => {
    const modes: PermissionModesResponse["modes"] = [
      { value: "default" },
      { value: "bypass" },
    ];
    expect(resolveRestoredPermissionMode(modes, turn)).toBe("bypass");
  });

  it("falls back to default when the last turn's bypass is withdrawn", () => {
    const modes: PermissionModesResponse["modes"] = [{ value: "default" }];
    expect(resolveRestoredPermissionMode(modes, turn)).toBe("default");
  });

  it("treats a missing listing as withdrawn rather than restoring bypass", () => {
    expect(resolveRestoredPermissionMode([], turn)).toBe("default");
  });
});

type HistorySyncProps = Parameters<typeof useChatHistorySync>[0];

function historySyncProps(
  overrides: Partial<HistorySyncProps> = {},
): HistorySyncProps {
  return {
    resume: false,
    resumeStream: vi.fn(async () => {}),
    refreshChatMessages: vi.fn(),
    chatMessages: [],
    messages: [],
    status: "error",
    setMessages: vi.fn(),
    interruption: null,
    ...overrides,
  };
}

function renderHistorySync(initialProps: HistorySyncProps) {
  return renderHook((props: HistorySyncProps) => useChatHistorySync(props), {
    initialProps,
  });
}

describe("useChatHistorySync", () => {
  it("probes the run log once per mount when the page asks to resume", async () => {
    const props = historySyncProps({ resume: true });
    const { rerender } = renderHistorySync(props);

    expect(props.resumeStream).toHaveBeenCalledTimes(1);
    // The history re-read rides the probe's settlement, not the same tick.
    await waitFor(() =>
      expect(props.refreshChatMessages).toHaveBeenCalledTimes(1),
    );

    rerender({ ...props, messages: [] });
    expect(props.resumeStream).toHaveBeenCalledTimes(1);
  });

  it("leaves the log alone when nothing asked for a probe", () => {
    const props = historySyncProps();
    renderHistorySync(props);

    expect(props.resumeStream).not.toHaveBeenCalled();
  });

  it("re-attaches to a run whose stream ended while it was executing", async () => {
    const props = historySyncProps({
      interruption: { runId: "run-1", seq: 1 },
    });
    renderHistorySync(props);

    expect(props.resumeStream).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(props.refreshChatMessages).toHaveBeenCalledTimes(1),
    );
  });

  it("ignores an interruption the effect already handled", () => {
    const props = historySyncProps({
      interruption: { runId: "run-1", seq: 1 },
    });
    const { rerender } = renderHistorySync(props);
    expect(props.resumeStream).toHaveBeenCalledTimes(1);

    // Same interruption re-rendered (a render the effect re-runs on) must not
    // attach twice.
    rerender({ ...props, messages: [] });
    expect(props.resumeStream).toHaveBeenCalledTimes(1);
  });

  it("does not double-attach when a failed send's recovery re-arms the resume probe", () => {
    // A `fresh` chat mid-send: no probe has run, then its stream drops.
    const props = historySyncProps({ resume: false });
    const { rerender } = renderHistorySync(props);
    expect(props.resumeStream).not.toHaveBeenCalled();

    let current: HistorySyncProps = {
      ...props,
      interruption: { runId: "run-1", seq: 1 },
    };
    rerender(current);
    expect(props.resumeStream).toHaveBeenCalledTimes(1);

    // The failed-send recovery drives the draft session to `persisted`, which
    // asks for the mount probe again — the repair already covered this run.
    current = { ...current, resume: true };
    rerender(current);
    expect(props.resumeStream).toHaveBeenCalledTimes(1);
  });
});
