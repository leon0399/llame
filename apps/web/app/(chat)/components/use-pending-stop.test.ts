// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { UIMessage } from "ai";

import { usePendingStop } from "./use-pending-stop";

function userOnly(): Array<Pick<UIMessage, "id" | "role">> {
  return [{ id: "user-1", role: "user" }];
}

function withAssistant(runId: string): Array<Pick<UIMessage, "id" | "role">> {
  return [
    { id: "user-1", role: "user" },
    { id: runId, role: "assistant" },
  ];
}

describe("usePendingStop", () => {
  it("cancels and stops immediately when the Run id is already known", async () => {
    const stop = vi.fn();
    const cancelRun = vi.fn().mockResolvedValue(undefined);
    const toastError = vi.fn();
    const { result } = renderHook(() =>
      usePendingStop({
        messages: withAssistant("run-known"),
        stop,
        status: "streaming",
        deps: { cancelRun, toastError },
      }),
    );

    await act(async () => {
      result.current.requestStop();
    });

    await waitFor(() => {
      expect(cancelRun).toHaveBeenCalledWith("run-known");
      expect(stop).toHaveBeenCalledOnce();
    });
    expect(result.current.pendingStop).toBe(false);
    expect(toastError).not.toHaveBeenCalled();
  });

  it("holds Stop until the placeholder row appears, then cancels and stops", async () => {
    const stop = vi.fn();
    const cancelRun = vi.fn().mockResolvedValue(undefined);
    const toastError = vi.fn();
    const { result, rerender } = renderHook(
      (props: { messages: ReadonlyArray<Pick<UIMessage, "id" | "role">> }) =>
        usePendingStop({
          messages: props.messages,
          stop,
          status: "submitted",
          deps: { cancelRun, toastError },
        }),
      { initialProps: { messages: userOnly() } },
    );

    await act(async () => {
      result.current.requestStop();
    });
    expect(result.current.pendingStop).toBe(true);
    expect(cancelRun).not.toHaveBeenCalled();
    expect(stop).not.toHaveBeenCalled();

    rerender({ messages: withAssistant("run-held") });

    await waitFor(() => {
      expect(cancelRun).toHaveBeenCalledWith("run-held");
      expect(stop).toHaveBeenCalledOnce();
    });
    expect(result.current.pendingStop).toBe(false);
  });

  it("clears a held Stop without cancelling when the send fails", async () => {
    const stop = vi.fn();
    const cancelRun = vi.fn().mockResolvedValue(undefined);
    const toastError = vi.fn();
    type Props = {
      messages: ReadonlyArray<Pick<UIMessage, "id" | "role">>;
      status: "submitted" | "streaming" | "ready" | "error";
    };
    const initialProps: Props = {
      messages: userOnly(),
      status: "submitted",
    };
    const { result, rerender } = renderHook(
      (props: Props) =>
        usePendingStop({
          messages: props.messages,
          stop,
          status: props.status,
          deps: { cancelRun, toastError },
        }),
      { initialProps },
    );

    await act(async () => {
      result.current.requestStop();
    });
    expect(result.current.pendingStop).toBe(true);

    const failed: Props = { messages: userOnly(), status: "error" };
    rerender(failed);

    expect(result.current.pendingStop).toBe(false);
    expect(cancelRun).not.toHaveBeenCalled();
    expect(stop).not.toHaveBeenCalled();

    // A following send must not re-arm the hold or cancel the next Run.
    rerender({ messages: userOnly(), status: "submitted" });
    expect(result.current.pendingStop).toBe(false);
    rerender({ messages: withAssistant("run-next"), status: "streaming" });
    expect(cancelRun).not.toHaveBeenCalled();
    expect(stop).not.toHaveBeenCalled();
  });

  it("cancels a held Stop when the id arrives in the same render as error", async () => {
    const stop = vi.fn();
    const cancelRun = vi.fn().mockResolvedValue(undefined);
    const toastError = vi.fn();
    type Props = {
      messages: ReadonlyArray<Pick<UIMessage, "id" | "role">>;
      status: "submitted" | "streaming" | "ready" | "error";
    };
    const initialProps: Props = {
      messages: userOnly(),
      status: "submitted",
    };
    const { result, rerender } = renderHook(
      (props: Props) =>
        usePendingStop({
          messages: props.messages,
          stop,
          status: props.status,
          deps: { cancelRun, toastError },
        }),
      { initialProps },
    );

    await act(async () => {
      result.current.requestStop();
    });
    expect(result.current.pendingStop).toBe(true);

    // Batched start frame + transport failure: id known, status already error.
    rerender({
      messages: withAssistant("run-err"),
      status: "error",
    });

    await waitFor(() => {
      expect(cancelRun).toHaveBeenCalledWith("run-err");
      expect(stop).toHaveBeenCalledOnce();
    });
    expect(result.current.pendingStop).toBe(false);
  });

  it("stops immediately without waiting for cancelRun", async () => {
    let resolveCancel: (() => void) | undefined;
    const cancelRun = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveCancel = resolve;
        }),
    );
    const stop = vi.fn();
    const toastError = vi.fn();
    const { result } = renderHook(() =>
      usePendingStop({
        messages: withAssistant("run-slow"),
        stop,
        status: "streaming",
        deps: { cancelRun, toastError },
      }),
    );

    await act(async () => {
      result.current.requestStop();
    });

    expect(stop).toHaveBeenCalledOnce();
    expect(cancelRun).toHaveBeenCalledWith("run-slow");
    resolveCancel?.();
  });

  it("still stops and toasts when cancelRun fails", async () => {
    const stop = vi.fn();
    const cancelRun = vi.fn().mockRejectedValue(new Error("network"));
    const toastError = vi.fn();
    const { result } = renderHook(() =>
      usePendingStop({
        messages: withAssistant("run-fail"),
        stop,
        status: "streaming",
        deps: { cancelRun, toastError },
      }),
    );

    await act(async () => {
      result.current.requestStop();
    });

    expect(stop).toHaveBeenCalledOnce();
    await waitFor(() => {
      expect(toastError).toHaveBeenCalledWith(
        "Couldn't confirm the response was stopped — it may still be finishing.",
      );
    });
  });
});
