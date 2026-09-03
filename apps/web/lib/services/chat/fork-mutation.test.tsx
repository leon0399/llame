// @vitest-environment jsdom

/** useForkChat hook coverage: a failed fork must toast, not fail silently. */

import * as React from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast } from "@workspace/ui/components/sonner";

import { useForkChat } from "./fork";
import { stubFetch } from "../../test-support/fetch-stub";

function wrapper({ children }: { children: React.ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

let fetchMock: Mock<typeof fetch>;

beforeEach(() => {
  fetchMock = stubFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useForkChat", () => {
  it("toasts on failure instead of failing silently", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    // `toast` is sonner's own real export (re-exported by
    // @workspace/ui/components/sonner) -- spying on its method observes the
    // real call without swapping the module underneath the hook.
    const toastErrorSpy = vi.spyOn(toast, "error").mockImplementation(() => "");
    const { result } = renderHook(() => useForkChat(), { wrapper });

    result.current.mutate({ chatId: "chat-1", fromMessageId: "msg-1" });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(toastErrorSpy).toHaveBeenCalledWith(
      "Couldn't fork the chat. Nothing was created.",
    );
  });
});
