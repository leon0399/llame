// @vitest-environment jsdom

import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const updatePersonalizationEndpoint = vi.hoisted(() => vi.fn());
const authenticatedFetch = vi.hoisted(() => vi.fn());
const createAuthenticatedBrowserFetch = vi.hoisted(() => vi.fn());

vi.mock("../../api/generated/personalization/personalization", () => ({
  updatePersonalization: updatePersonalizationEndpoint,
}));
vi.mock("../../api/fetch", () => ({
  createAuthenticatedBrowserFetch,
}));

import {
  personalizationMutationKeys,
  updatePersonalization,
  useUpdatePersonalizationMutation,
} from "./mutations";
import { personalizationQueryKeys } from "./queries";
import type { Personalization } from "./types";

createAuthenticatedBrowserFetch.mockReturnValue(authenticatedFetch);

const initial: Personalization = {
  preferredName: null,
  about: "Builds llame",
  responsePreferences: null,
  enabled: true,
  shareAccountIdentity: false,
};

function wrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

afterEach(() => {
  vi.clearAllMocks();
  createAuthenticatedBrowserFetch.mockReturnValue(authenticatedFetch);
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
    updatePersonalizationEndpoint.mockResolvedValue(response);

    await expect(updatePersonalization(input)).resolves.toEqual(response);

    expect(updatePersonalizationEndpoint).toHaveBeenCalledWith(
      input,
      undefined,
      authenticatedFetch,
    );
    expect(createAuthenticatedBrowserFetch).toHaveBeenCalledWith(
      globalThis.fetch,
    );
  });
});

describe("useUpdatePersonalizationMutation cache behavior", () => {
  it("cancels, snapshots, patches optimistically, and serializes profile updates", async () => {
    updatePersonalizationEndpoint.mockReturnValue(new Promise(() => {}));
    const queryClient = createQueryClient();
    const cancelQueries = vi.spyOn(queryClient, "cancelQueries");
    queryClient.setQueryData(personalizationQueryKeys.mine(), initial);

    const { result } = renderHook(() => useUpdatePersonalizationMutation(), {
      wrapper: wrapper(queryClient),
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
    const error = new Error("network down");
    updatePersonalizationEndpoint.mockRejectedValue(error);
    const queryClient = createQueryClient();
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
    queryClient.setQueryData(personalizationQueryKeys.mine(), initial);

    const { result } = renderHook(() => useUpdatePersonalizationMutation(), {
      wrapper: wrapper(queryClient),
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
    updatePersonalizationEndpoint.mockResolvedValue({
      ...initial,
      enabled: false,
    });
    const queryClient = createQueryClient();
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useUpdatePersonalizationMutation(), {
      wrapper: wrapper(queryClient),
    });
    result.current.mutate({ enabled: false });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: personalizationQueryKeys.mine(),
    });
  });
});
