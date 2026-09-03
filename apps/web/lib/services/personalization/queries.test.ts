// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

import {
  fetchPersonalization,
  personalizationQueryKeys,
  usePersonalizationQuery,
} from "./queries";
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
// endpoint, the authenticated-fetch policy, URL construction and JSON parsing
// all run for real. The previous version mocked the generated module, the
// fetch policy AND `useQuery` itself, which meant the assertions only ever
// echoed their own fixtures back.
let fetchMock: Mock<typeof fetch>;

const profile = {
  preferredName: "Leo",
  about: null,
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

describe("personalization query keys", () => {
  it("keeps the resource-path keys", () => {
    expect(personalizationQueryKeys.all).toEqual(["personalization"]);
    expect(personalizationQueryKeys.mine()).toEqual(["personalization", "me"]);
  });
});

describe("personalization query transport", () => {
  it("fetches the caller's profile through the generated authenticated endpoint", async () => {
    fetchMock.mockResolvedValue(jsonResponse(profile));

    await expect(fetchPersonalization()).resolves.toEqual(profile);

    const request = requestFromCall(fetchMock);
    expect(request.method).toBe("GET");
    expect(new URL(request.url).pathname).toBe("/api/v1/me/personalization");
    // The authenticated browser policy sends the session cookie.
    expect(request.credentials).toBe("include");
  });

  it("resolves the profile through the hook under its own query key", async () => {
    fetchMock.mockResolvedValue(jsonResponse(profile));
    const queryClient = newTestQueryClient();

    const { result } = renderHook(() => usePersonalizationQuery(), {
      wrapper: wrapperWithClient(queryClient),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(result.current.data).toEqual(profile);
    // Cached under the factory's key, not merely requested with it.
    expect(queryClient.getQueryData(personalizationQueryKeys.mine())).toEqual(
      profile,
    );
  });
});
