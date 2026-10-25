// @vitest-environment jsdom

/**
 * The create call's cache effects: a successful start moves the chat list, the
 * project's links, the location preview, and the checkout rows. The header's
 * read-only chip reads the last of those, so a worktree start that skips it
 * leaves the new branch unnameable until a reload.
 */

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

import { checkoutQueryKeys } from "../checkouts/queries";
import { projectQueryKeys } from "../project/queries";
import { startLocationQueryKeys } from "../project/start-location";
import {
  jsonResponse,
  requestFromCall,
  stubFetch,
} from "../../test-support/fetch-stub";
import {
  newTestQueryClient,
  wrapperWithClient,
} from "../../test-support/query-client";
import { useCreateChat } from "./creation";
import { chatQueryKeys } from "./queries";

let fetchMock: Mock<typeof fetch>;

beforeEach(() => {
  fetchMock = stubFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useCreateChat", () => {
  it("invalidates the checkout rows so the header can name a new worktree", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        chat: { id: "chat-1" },
        workspace: { status: "bound" },
      }),
    );
    const queryClient = newTestQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useCreateChat(), {
      wrapper: wrapperWithClient(queryClient),
    });

    result.current.mutate({ id: "chat-1" });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(requestFromCall(fetchMock).method).toBe("POST");
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: chatQueryKeys.lists(),
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: checkoutQueryKeys.lists(),
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: projectQueryKeys.repositoryLinks(),
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: startLocationQueryKeys.all,
    });
  });
});
