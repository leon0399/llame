// @vitest-environment jsdom

/**
 * next/navigation is the external boundary (permitted mock target) —
 * DeleteChatDialog's useRouter() (navigate away before deleting the active
 * chat) has no in-process seam otherwise. Real mutation hooks run against a
 * stubbed globalThis.fetch.
 */

import type { ReactElement } from "react";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { Mock } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import {
  emptyResponse,
  requestFromCall,
  stubFetch,
} from "@/lib/test-support/fetch-stub";

const { routerPushMock } = vi.hoisted(() => ({ routerPushMock: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPushMock }),
}));

import { DeleteChatDialog, RenameChatDialog } from "./chat-item-dialogs";

let fetchMock: Mock<typeof fetch>;
let queryClient: QueryClient;

const chat = { id: "c1", title: "Trip to Lisbon" };

function renderWithClient(node: ReactElement) {
  return render(
    <QueryClientProvider client={queryClient}>{node}</QueryClientProvider>,
  );
}

function nameFieldValue(): string {
  // SAFETY: resolved via getByLabelText on the dialog's own <Input>, always
  // an HTMLInputElement.
  return (screen.getByLabelText("Chat title") as HTMLInputElement).value;
}

beforeAll(() => {
  for (const method of [
    "hasPointerCapture",
    "setPointerCapture",
    "releasePointerCapture",
  ] as const) {
    if (!(method in Element.prototype)) {
      Object.defineProperty(Element.prototype, method, {
        value: () => false,
        writable: true,
      });
    }
  }
});

beforeEach(() => {
  fetchMock = stubFetch();
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
});

afterEach(() => {
  routerPushMock.mockReset();
  cleanup();
  vi.unstubAllGlobals();
});

describe("RenameChatDialog", () => {
  it("Save with an unchanged title closes without a mutation", () => {
    const onOpenChange = vi.fn();
    renderWithClient(
      <RenameChatDialog chat={chat} open onOpenChange={onOpenChange} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("Save with a changed title PATCHes and closes on success", async () => {
    fetchMock.mockResolvedValue(emptyResponse());
    const onOpenChange = vi.fn();
    renderWithClient(
      <RenameChatDialog chat={chat} open onOpenChange={onOpenChange} />,
    );

    fireEvent.change(screen.getByLabelText("Chat title"), {
      target: { value: "Trip to Porto" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    const request = requestFromCall(fetchMock);
    expect(request.method).toBe("PATCH");
    expect(new URL(request.url).pathname).toBe("/api/v1/chats/c1");
    await expect(request.clone().json()).resolves.toEqual({
      title: "Trip to Porto",
    });
  });

  it("resets the field to the CURRENT title each time it reopens", () => {
    const { rerender } = renderWithClient(
      <RenameChatDialog chat={chat} open={false} onOpenChange={vi.fn()} />,
    );
    rerender(
      <QueryClientProvider client={queryClient}>
        <RenameChatDialog
          chat={{ ...chat, title: "Updated elsewhere" }}
          open
          onOpenChange={vi.fn()}
        />
      </QueryClientProvider>,
    );

    expect(nameFieldValue()).toBe("Updated elsewhere");
  });
});

describe("DeleteChatDialog", () => {
  it("confirming deletion of the ACTIVE chat navigates home before the DELETE lands", async () => {
    fetchMock.mockResolvedValue(emptyResponse());
    const onOpenChange = vi.fn();
    renderWithClient(
      <DeleteChatDialog
        chat={chat}
        isActive
        open
        onOpenChange={onOpenChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    expect(routerPushMock).toHaveBeenCalledWith("/");
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    const request = requestFromCall(fetchMock);
    expect(request.method).toBe("DELETE");
    expect(new URL(request.url).pathname).toBe("/api/v1/chats/c1");
  });

  it("confirming deletion of a chat that is NOT active never navigates", async () => {
    fetchMock.mockResolvedValue(emptyResponse());
    renderWithClient(
      <DeleteChatDialog
        chat={chat}
        isActive={false}
        open
        onOpenChange={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(routerPushMock).not.toHaveBeenCalled();
  });
});
