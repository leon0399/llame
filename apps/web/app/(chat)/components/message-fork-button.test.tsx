// @vitest-environment jsdom

/**
 * Render-level proof that the fork-from-here affordance is actually reachable
 * in the DOM and wired to the fork mutation — not just source-text asserted.
 * (#141: the message-level fork action was structurally present but easy to
 * miss; this both fixes the visibility — a persistent MessageActions row
 * instead of a bare floating icon — and proves it with a real render.)
 */

// Explicit React import: the shared tsconfig sets jsx: "preserve" (Next.js
// itself does the JSX transform), so vitest's underlying esbuild falls back
// to the classic transform here, which needs React in scope.
import React, { type ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const mutateMock = vi.fn();
let isPending = false;

vi.mock("../../../lib/services/chat/fork", () => ({
  useForkChat: () => ({
    mutate: mutateMock,
    get isPending() {
      return isPending;
    },
  }),
}));

import { MessageForkButton } from "./message-fork-button";

function renderWithClient(ui: ReactElement) {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
}

afterEach(() => {
  mutateMock.mockReset();
  isPending = false;
  cleanup();
});

describe("MessageForkButton", () => {
  it("renders a reachable, always-visible fork affordance", () => {
    renderWithClient(
      <MessageForkButton
        chatId="chat-1"
        fromMessageId="msg-2"
        onForked={vi.fn()}
      />,
    );

    const button = screen.getByRole("button", { name: /fork from here/i });
    expect(button).toBeTruthy();
    expect((button as HTMLButtonElement).disabled).toBe(false);
  });

  it("invokes the fork mutation with the chat + message id on click", () => {
    renderWithClient(
      <MessageForkButton
        chatId="chat-1"
        fromMessageId="msg-2"
        onForked={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /fork from here/i }));

    expect(mutateMock).toHaveBeenCalledTimes(1);
    expect(mutateMock).toHaveBeenCalledWith(
      { chatId: "chat-1", fromMessageId: "msg-2" },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });

  it("navigates via onForked when the mutation succeeds", () => {
    const onForked = vi.fn();
    renderWithClient(
      <MessageForkButton
        chatId="chat-1"
        fromMessageId="msg-2"
        onForked={onForked}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /fork from here/i }));

    const [, { onSuccess }] = mutateMock.mock.calls[0] as [
      unknown,
      { onSuccess: (forked: { id: string }) => void },
    ];
    onSuccess({ id: "forked-chat-9" });

    expect(onForked).toHaveBeenCalledWith("forked-chat-9");
  });

  it("disables the button while a fork is pending (no double-submit)", () => {
    isPending = true;
    renderWithClient(
      <MessageForkButton
        chatId="chat-1"
        fromMessageId="msg-2"
        onForked={vi.fn()}
      />,
    );

    const button = screen.getByRole("button", {
      name: /fork from here/i,
    }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });
});
