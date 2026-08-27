// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { parseMessageTargetHash, useMessageTarget } from "./message-target";

describe("parseMessageTargetHash", () => {
  it.each([
    ["#msg-1", 1],
    ["#msg-9007199254740991", 9007199254740991],
  ])("accepts %s as sequence %s", (hash, expected) => {
    expect(parseMessageTargetHash(hash)).toBe(expected);
  });

  it.each([
    "",
    "#",
    "#msg-0",
    "#msg-01",
    "#msg--1",
    "#msg-1.5",
    "#msg-9007199254740992",
    "#msg-1x",
    "#message-1",
    "msg-1",
  ])("treats malformed hash %s as ordinary history", (hash) => {
    expect(parseMessageTargetHash(hash)).toBeNull();
  });
});

describe("useMessageTarget", () => {
  afterEach(() => {
    cleanup();
    window.history.replaceState(window.history.state, "", "/chat/chat-1");
    vi.restoreAllMocks();
  });

  it("reads the hash after hydration and reacts to one hashchange listener", async () => {
    const addEventListener = vi.spyOn(window, "addEventListener");
    const removeEventListener = vi.spyOn(window, "removeEventListener");
    const { result, unmount } = renderHook(() => useMessageTarget("chat-1"));

    expect(result.current).toBeNull();
    expect(
      addEventListener.mock.calls.filter(([type]) => type === "hashchange"),
    ).toHaveLength(1);

    window.history.replaceState(
      window.history.state,
      "",
      "/chat/chat-1#msg-42",
    );
    act(() => {
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });

    await waitFor(() => expect(result.current).toBe(42));

    window.history.replaceState(window.history.state, "", "/chat/chat-1");
    act(() => {
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });

    await waitFor(() => expect(result.current).toBeNull());
    unmount();
    expect(
      removeEventListener.mock.calls.filter(([type]) => type === "hashchange"),
    ).toHaveLength(1);
  });

  it("does not carry a prior chat target into a different chat", async () => {
    window.history.replaceState(
      window.history.state,
      "",
      "/chat/chat-1#msg-42",
    );

    const { result, rerender } = renderHook(
      ({ chatId }) => useMessageTarget(chatId),
      { initialProps: { chatId: "chat-1" } },
    );
    await waitFor(() => expect(result.current).toBe(42));

    window.history.replaceState(window.history.state, "", "/chat/chat-2");
    rerender({ chatId: "chat-2" });
    expect(result.current).toBeNull();
  });
});
