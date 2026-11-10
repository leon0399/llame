// @vitest-environment jsdom

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";
import { focusManager, QueryClient } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";

import { fetchChatGitState, useChatGitStateQuery } from "./queries";
import {
  jsonResponse,
  requestFromCall,
  stubFetch,
} from "../../test-support/fetch-stub";
import {
  newTestQueryClient,
  wrapperWithClient,
} from "../../test-support/query-client";

let fetchMock: Mock<typeof fetch>;

beforeEach(() => {
  fetchMock = stubFetch();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("fetchChatGitState", () => {
  it("reads the owner route for the chat", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ status: "unbound" }));
    await expect(fetchChatGitState("c1")).resolves.toEqual({
      status: "unbound",
    });

    const request = requestFromCall(fetchMock);
    expect(request.method).toBe("GET");
    expect(new URL(request.url).pathname).toBe("/api/v1/chats/c1/git-state");
    expect(request.credentials).toBe("include");
  });
});

describe("useChatGitStateQuery", () => {
  function render(
    client: QueryClient,
    workspaceRoot: string | null,
    panelOpen: boolean,
  ) {
    return renderHook(
      () => useChatGitStateQuery("c1", workspaceRoot, panelOpen),
      { wrapper: wrapperWithClient(client) },
    );
  }

  it("does not read while the panel is closed or the chat is unbound", async () => {
    const client = newTestQueryClient();
    render(client, "/work/shop", false);
    render(client, null, true);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reads once the panel is open on a bound chat", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ status: "unavailable", reason: "timeout", line: "x" }),
    );
    const { result } = render(newTestQueryClient(), "/work/shop", true);
    await waitFor(() =>
      expect(result.current.data?.status).toBe("unavailable"),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refetches on window focus despite the default stale time", async () => {
    fetchMock.mockImplementation(async () =>
      jsonResponse({ status: "unbound" }),
    );

    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: 60_000 } },
    });

    const { result } = render(client, "/work/shop", true);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    focusManager.setFocused(false);
    focusManager.setFocused(true);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });
});
