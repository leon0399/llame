// @vitest-environment jsdom
/**
 * The follow-up sender `ChatSessionContent` threads to the turn actions. It
 * marks the send the way the composer's submit does, because the finish path
 * refreshes history and clears a target send's tracking only for a marked
 * send — an unmarked follow-up in a `#msg-N` view would leave the transcript
 * and `latestRun` stale.
 */

import { act, renderHook } from "@testing-library/react";
import type { ChatRequestOptions } from "ai";
import { describe, expect, it, vi } from "vitest";

import { useFollowUpRun } from "./use-chat-conversation";

type RegenerateOptions = { messageId?: string } & ChatRequestOptions;

describe("useFollowUpRun", () => {
  it("marks the send before it starts the follow-up Run", async () => {
    const regenerate = vi.fn(async (_options?: RegenerateOptions) => {});
    const onSendStarted = vi.fn();
    const { result } = renderHook(() =>
      useFollowUpRun(regenerate, onSendStarted),
    );

    await act(async () => {
      result.current({ action: "continue", permissionMode: "bypass" });
    });

    expect(onSendStarted).toHaveBeenCalledTimes(1);
    expect(regenerate).toHaveBeenCalledWith({
      body: { action: "continue", permissionMode: "bypass" },
    });
    expect(onSendStarted.mock.invocationCallOrder[0]).toBeLessThan(
      regenerate.mock.invocationCallOrder[0],
    );
  });
});
