// @vitest-environment jsdom

/**
 * useSetChatVisibility runs for real against a stubbed globalThis.fetch.
 * navigator.clipboard is a real browser global (external, permitted) —
 * stubbed for a deterministic writeText result rather than relying on
 * jsdom's execCommand fallback.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { requestFromCall, stubFetch } from "@/lib/test-support/fetch-stub";

import { ShareChatDialog } from "./share-chat-dialog";

let fetchMock: Mock<typeof fetch>;
let queryClient: QueryClient;
let writeTextMock: Mock<(text: string) => Promise<void>>;

beforeEach(() => {
  fetchMock = stubFetch();
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  writeTextMock = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { clipboard: { writeText: writeTextMock } });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function switchChecked(): boolean {
  return (
    screen.getByLabelText("Share publicly").getAttribute("aria-checked") ===
    "true"
  );
}

function switchDisabled(): boolean {
  return (
    screen.getByLabelText("Share publicly").getAttribute("aria-disabled") ===
    "true"
  );
}

function renderDialog(chat: { id: string; visibility: "private" | "public" }) {
  return render(
    <QueryClientProvider client={queryClient}>
      <ShareChatDialog chat={chat} open onOpenChange={vi.fn()} />
    </QueryClientProvider>,
  );
}

describe("ShareChatDialog", () => {
  it("shows no share link while private", () => {
    renderDialog({ id: "c1", visibility: "private" });

    expect(switchChecked()).toBe(false);
    expect(screen.queryByLabelText("Share link")).toBeNull();
  });

  it("toggling on PATCHes visibility:public and shows the target state while pending", async () => {
    const pending = new Promise<Response>(() => {});
    fetchMock.mockReturnValue(pending);
    renderDialog({ id: "c1", visibility: "private" });

    fireEvent.click(screen.getByLabelText("Share publicly"));

    await waitFor(() => expect(switchChecked()).toBe(true));
    // The link row and toggle already read as public even though the
    // mutation has not settled — the stale-prop bug this hook guards
    // against would show the switch snapping back to off here. (`chat` is a
    // frozen prop in this isolated render — the real app re-derives it from
    // the invalidated query once the mutation settles.)
    expect(switchDisabled()).toBe(true);
    // SAFETY: resolved via getByLabelText on the dialog's own read-only
    // <Input>, always an HTMLInputElement.
    const link = screen.getByLabelText("Share link") as HTMLInputElement;
    expect(link.value).toContain("/shared/c1");

    const request = requestFromCall(fetchMock);
    expect(request.method).toBe("PATCH");
    expect(new URL(request.url).pathname).toBe("/api/v1/chats/c1");
    await expect(request.clone().json()).resolves.toEqual({
      visibility: "public",
    });
  });

  it("already public: toggling off hides the share link while the PATCH is pending", async () => {
    const pending = new Promise<Response>(() => {});
    fetchMock.mockReturnValue(pending);
    renderDialog({ id: "c1", visibility: "public" });

    expect(screen.getByLabelText("Share link")).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Share publicly"));

    await waitFor(() => expect(switchChecked()).toBe(false));
    expect(screen.queryByLabelText("Share link")).toBeNull();
  });

  it("Copy link writes the link to the clipboard", async () => {
    renderDialog({ id: "c1", visibility: "public" });

    await act(async () => {
      fireEvent.click(screen.getByLabelText("Copy link"));
    });

    expect(writeTextMock).toHaveBeenCalledWith(
      expect.stringContaining("/shared/c1"),
    );
  });
});
