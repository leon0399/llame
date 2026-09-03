import { afterEach, describe, expect, it, vi } from "vitest";

const getPersonalization = vi.hoisted(() => vi.fn());
const authenticatedFetch = vi.hoisted(() => vi.fn());
const createAuthenticatedBrowserFetch = vi.hoisted(() => vi.fn());
const useQuery = vi.hoisted(() => vi.fn());

vi.mock("../../api/generated/personalization/personalization", () => ({
  getPersonalization,
}));
vi.mock("../../api/fetch", () => ({
  createAuthenticatedBrowserFetch,
}));
vi.mock("@tanstack/react-query", () => ({ useQuery }));

import {
  fetchPersonalization,
  personalizationQueryKeys,
  usePersonalizationQuery,
} from "./queries";

createAuthenticatedBrowserFetch.mockReturnValue(authenticatedFetch);

afterEach(() => {
  vi.clearAllMocks();
  createAuthenticatedBrowserFetch.mockReturnValue(authenticatedFetch);
});

describe("personalization query keys", () => {
  it("keeps the resource-path keys", () => {
    expect(personalizationQueryKeys.all).toEqual(["personalization"]);
    expect(personalizationQueryKeys.mine()).toEqual(["personalization", "me"]);
  });
});

describe("personalization query transport", () => {
  it("fetches the caller's profile through the generated authenticated endpoint", async () => {
    const response = {
      preferredName: "Leo",
      about: null,
      responsePreferences: null,
      enabled: true,
      shareAccountIdentity: false,
    };
    getPersonalization.mockResolvedValue(response);

    await expect(fetchPersonalization()).resolves.toEqual(response);

    expect(getPersonalization).toHaveBeenCalledWith(
      undefined,
      authenticatedFetch,
    );
    expect(createAuthenticatedBrowserFetch).toHaveBeenCalledWith(
      globalThis.fetch,
    );
  });

  it("preserves the personalization query key and default query options", () => {
    usePersonalizationQuery();

    expect(useQuery).toHaveBeenCalledWith({
      queryKey: personalizationQueryKeys.mine(),
      queryFn: fetchPersonalization,
    });
  });
});
