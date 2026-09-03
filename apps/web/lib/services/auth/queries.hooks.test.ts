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
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";

import { authQueryKeys, useMe, useMeOptional } from "./queries";
import { jsonResponse, stubFetch } from "../../test-support/fetch-stub";
import {
  newTestQueryClient,
  wrapperWithClient,
} from "../../test-support/query-client";

// Split from queries.test.ts: these hook tests need jsdom for renderHook.
// The plain-function transport tests stay in the default node environment,
// where `window` is undefined and handleUnauthorizedResponse()'s redirect
// branch never fires -- see the comment there.
let fetchMock: Mock<typeof fetch>;

beforeEach(() => {
  fetchMock = stubFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("auth query hooks", () => {
  it("refetches on mount even with already-fresh cached data (staleTime: 0, refetchOnMount: 'always')", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: "u1", name: "A" }));
    // A high default staleTime means cached data reads as fresh under the
    // client's own defaults; only the hook's per-query overrides can still
    // force a network refetch on mount.
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: 5 * 60_000 } },
    });
    queryClient.setQueryData(authQueryKeys.me, {
      id: "cached",
      name: "Cached",
    });

    const { result } = renderHook(() => useMe(), {
      wrapper: wrapperWithClient(queryClient),
    });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(result.current.data).toEqual({ id: "u1", name: "A" }),
    );
  });

  it("resolves the optional me query's data reactively", async () => {
    const user = { id: "u1", name: "A" };
    fetchMock.mockResolvedValue(jsonResponse(user));

    const { result } = renderHook(() => useMeOptional(), {
      wrapper: wrapperWithClient(newTestQueryClient()),
    });

    await waitFor(() => expect(result.current.data).toEqual(user));
  });

  it("does not retry the optional me query (retry: false)", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ message: "down" }, 500));
    // No client-level retry:false here -- only the hook's own override can
    // keep this from retrying with React Query's default backoff, which
    // would otherwise blow the waitFor timeout below.
    const queryClient = new QueryClient();

    const { result } = renderHook(() => useMeOptional(), {
      wrapper: wrapperWithClient(queryClient),
    });

    await waitFor(() => expect(result.current.isError).toBe(true), {
      timeout: 500,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
