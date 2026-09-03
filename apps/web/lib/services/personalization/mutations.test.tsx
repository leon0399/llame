// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

import {
  personalizationMutationKeys,
  updatePersonalization,
  useUpdatePersonalizationMutation,
} from "./mutations";
import { personalizationQueryKeys } from "./queries";
import type { Personalization } from "./types";
import {
  jsonResponse,
  requestFromCall,
  stubFetch,
} from "../../test-support/fetch-stub";
import {
  newTestQueryClient,
  wrapperWithClient,
} from "../../test-support/query-client";

// No module mocking: `stubFetch` replaces globalThis.fetch, so the generated
// endpoint, the authenticated-fetch policy, URL construction, the request body
// and JSON parsing all run for real. Controlling resolution timing still works
// — a never-settling or rejecting fetch drives the same cache paths the
// endpoint mock used to.
let fetchMock: Mock<typeof fetch>;

const initial: Personalization = {
  preferredName: null,
  about: "Builds llame",
  responsePreferences: null,
  enabled: true,
  shareAccountIdentity: false,
};

beforeEach(() => {
  fetchMock = stubFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("personalization mutation transport", () => {
  it("PATCHes the caller's profile through the generated authenticated endpoint", async () => {
    const input = {
      preferredName: null,
      about: "Builds llame",
      responsePreferences: null,
      enabled: false,
    };
    const response = { ...initial, ...input };
    fetchMock.mockResolvedValue(jsonResponse(response));

    await expect(updatePersonalization(input)).resolves.toEqual(response);

    const request = requestFromCall(fetchMock);
    expect(request.method).toBe("PATCH");
    expect(new URL(request.url).pathname).toBe("/api/v1/me/personalization");
    expect(request.credentials).toBe("include");
    await expect(request.json()).resolves.toEqual(input);
  });
});

describe("useUpdatePersonalizationMutation cache behavior", () => {
  it("cancels, snapshots, patches optimistically, and serializes profile updates", async () => {
    // Never settles: holds the mutation in flight so the optimistic patch is
    // observable before any response arrives.
    fetchMock.mockReturnValue(new Promise(() => {}));
    const queryClient = newTestQueryClient();
    const cancelQueries = vi.spyOn(queryClient, "cancelQueries");
    queryClient.setQueryData(personalizationQueryKeys.mine(), initial);

    const { result } = renderHook(() => useUpdatePersonalizationMutation(), {
      wrapper: wrapperWithClient(queryClient),
    });
    result.current.mutate({ enabled: false });

    await waitFor(() => {
      expect(queryClient.getQueryData(personalizationQueryKeys.mine())).toEqual(
        { ...initial, enabled: false },
      );
    });

    expect(cancelQueries).toHaveBeenCalledWith({
      queryKey: personalizationQueryKeys.mine(),
    });
    expect(queryClient.getMutationCache().getAll()[0]?.options.scope).toEqual({
      id: "personalization",
    });
    expect(personalizationMutationKeys.update()).toEqual([
      "personalization",
      "mutations",
      "update",
    ]);
  });

  it("rolls back the snapshot and invalidates after a failed update", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    const queryClient = newTestQueryClient();
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
    queryClient.setQueryData(personalizationQueryKeys.mine(), initial);

    const { result } = renderHook(() => useUpdatePersonalizationMutation(), {
      wrapper: wrapperWithClient(queryClient),
    });
    result.current.mutate({ about: "Changed" });

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(queryClient.getQueryData(personalizationQueryKeys.mine())).toEqual(
      initial,
    );
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: personalizationQueryKeys.mine(),
    });
  });

  it("invalidates after a successful update", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ...initial, enabled: false }));
    const queryClient = newTestQueryClient();
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useUpdatePersonalizationMutation(), {
      wrapper: wrapperWithClient(queryClient),
    });
    result.current.mutate({ enabled: false });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: personalizationQueryKeys.mine(),
    });
  });
});
