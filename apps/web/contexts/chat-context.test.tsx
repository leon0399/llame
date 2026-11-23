// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ChatProvider, useChatContext } from "./chat-context";

/** The provider's context in a hook, as a page's composer reads it. */
function renderComposer() {
  return renderHook(() => useChatContext(), { wrapper: ChatProvider });
}

describe("ChatProvider picks", () => {
  it("forgets unsent picks when another Chat registers", () => {
    const { result } = renderComposer();

    act(() => result.current.registerChatSelection("chat-a", null, true));
    act(() => {
      result.current.pickSelector("@fast");
      result.current.pickEffort("high");
    });

    expect(result.current.pickedSelector).toBe("@fast");
    expect(result.current.pickedEffort).toBe("high");

    act(() => result.current.registerChatSelection("chat-b", null, true));

    expect(result.current.pickedSelector).toBeUndefined();
    expect(result.current.pickedEffort).toBeUndefined();
  });

  it("keeps an unsent pick while the same Chat re-registers", () => {
    const { result } = renderComposer();

    act(() => result.current.registerChatSelection("chat-a", null, true));
    act(() => result.current.pickSelector("@fast"));

    act(() =>
      result.current.registerChatSelection(
        "chat-a",
        { selector: "@coding", effort: null },
        true,
      ),
    );

    expect(result.current.pickedSelector).toBe("@fast");
  });
});

describe("ChatProvider acceptSend", () => {
  it("shows the accepted selection and turns a draft into a stored Chat", () => {
    const { result } = renderComposer();

    act(() => result.current.registerChatSelection("chat-a", null, false));
    act(() => result.current.pickSelector("@plain"));

    act(() =>
      result.current.acceptSend({ selector: "@plain", effort: "high" }),
    );

    expect(result.current.displayedSelection).toEqual({
      selector: "@plain",
      effort: "high",
    });
    expect(result.current.chatExists).toBe(true);
    expect(result.current.pickedSelector).toBeUndefined();
  });

  it("keeps the stored selection when the send stored none", () => {
    const stored = { selector: "@coding", effort: null };
    const { result } = renderComposer();

    act(() => result.current.registerChatSelection("chat-a", stored, true));
    act(() => result.current.pickEffort("low"));

    act(() => result.current.acceptSend(null));

    expect(result.current.displayedSelection).toEqual(stored);
    expect(result.current.pickedEffort).toBeUndefined();
  });
});
