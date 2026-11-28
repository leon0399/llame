// @vitest-environment jsdom
/**
 * The follow-up sender `ChatSessionContent` threads to the turn actions. It
 * marks the send the way the composer's submit does, because the finish path
 * refreshes history and clears a target send's tracking only for a marked
 * send — an unmarked follow-up in a `#msg-N` view would leave the transcript
 * and `latestRun` stale. It also re-reads history once the follow-up segment
 * settles, because a Continue on the next candidate keeps the failed reply and
 * adds a switch host message that only history carries.
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
    const refreshChatMessages = vi.fn();

    const { result } = renderHook(() =>
      useFollowUpRun(regenerate, onSendStarted, refreshChatMessages),
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

  it("re-reads history after the follow-up segment settles", async () => {
    let settle!: () => void;
    // Executor form: apps/web's TypeScript lib predates Promise.withResolvers.

    const regenerate = vi.fn(
      () => new Promise<void>((resolve) => (settle = resolve)),
    );

    const refreshChatMessages = vi.fn();

    const { result } = renderHook(() =>
      useFollowUpRun(regenerate, vi.fn(), refreshChatMessages),
    );

    await act(async () => {
      result.current({ action: "continue", candidate: "next" });
    });

    // Still streaming: the failed reply and the switch host message are not
    // history yet.
    expect(refreshChatMessages).not.toHaveBeenCalled();

    await act(async () => {
      settle();
    });

    expect(refreshChatMessages).toHaveBeenCalledTimes(1);
  });

  it("re-reads history even when the follow-up stream fails", async () => {
    const regenerate = vi.fn(async () => {
      throw new Error("stream broke");
    });

    const refreshChatMessages = vi.fn();

    const { result } = renderHook(() =>
      useFollowUpRun(regenerate, vi.fn(), refreshChatMessages),
    );

    await act(async () => {
      result.current({ action: "continue", candidate: "next" });
    });

    expect(refreshChatMessages).toHaveBeenCalledTimes(1);
  });
});
