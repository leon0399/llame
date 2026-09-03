// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

import {
  typedKeys,
  usePersonalizationDraft,
} from "./use-personalization-draft";
import {
  jsonResponse,
  requestFromCall,
  stubFetch,
} from "@/lib/test-support/fetch-stub";
import {
  newTestQueryClient,
  wrapperWithClient,
} from "@/lib/test-support/query-client";
import { PERSONALIZATION_CAPS } from "@/lib/services/personalization/types";
import type { PersonalizationResponse } from "@/lib/services/personalization/types";
import type { PublicUserResponse } from "@/lib/services/auth/queries";

// No first-party module mocking: `stubFetch` replaces globalThis.fetch, so the
// generated endpoints, the authenticated-fetch policy, and both real query/
// mutation hooks this draft hook composes all run for real.
let fetchMock: Mock<typeof fetch>;

const profile: PersonalizationResponse = {
  preferredName: "Leo",
  about: "Loves cats",
  responsePreferences: "Be terse",
  enabled: true,
  shareAccountIdentity: false,
};

const account: PublicUserResponse = {
  id: "u1",
  name: "Leo",
  email: "leo@example.com",
  emailVerified: null,
  image: null,
};

type RouteOverrides = {
  getPersonalization?: () => Response | Promise<Response>;
  patchPersonalization?: () => Response | Promise<Response>;
  getMe?: () => Response | Promise<Response>;
};

function routeFetch(overrides: RouteOverrides = {}) {
  fetchMock.mockImplementation(async (input) => {
    // The Request constructor accepts the same RequestInfo | URL union as
    // fetch's own first parameter, so no cast is needed here.
    const request = input instanceof Request ? input : new Request(input);
    const path = new URL(request.url).pathname;
    if (path === "/api/v1/me/personalization" && request.method === "GET") {
      return overrides.getPersonalization?.() ?? jsonResponse(profile);
    }
    if (path === "/api/v1/me/personalization" && request.method === "PATCH") {
      return overrides.patchPersonalization?.() ?? jsonResponse(profile);
    }
    if (path === "/auth/v1/me") {
      return overrides.getMe?.() ?? jsonResponse(account);
    }
    throw new Error(`unstubbed fetch: ${request.method} ${path}`);
  });
}

function renderDraft() {
  const queryClient = newTestQueryClient();
  const view = renderHook(() => usePersonalizationDraft(), {
    wrapper: wrapperWithClient(queryClient),
  });
  return { ...view, queryClient };
}

beforeEach(() => {
  fetchMock = stubFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("typedKeys", () => {
  it("returns the caps object's own keys in declaration order", () => {
    // Literal anchor (docs/testing.md rule 11): pins the key set this hook's
    // dirty/overCap/isSaving checks all iterate over.
    expect(typedKeys(PERSONALIZATION_CAPS)).toEqual([
      "preferredName",
      "about",
      "responsePreferences",
    ]);
  });
});

describe("usePersonalizationDraft", () => {
  it("adopts the server profile on load, but never overwrites a dirty edit on refetch", async () => {
    routeFetch();
    const { result, queryClient } = renderDraft();

    await waitFor(() =>
      expect(result.current.draft).toEqual({
        preferredName: profile.preferredName,
        about: profile.about,
        responsePreferences: profile.responsePreferences,
      }),
    );
    expect(result.current.dirty).toBe(false);

    act(() => {
      result.current.setField("preferredName", "Leo (edited)");
    });
    expect(result.current.dirty).toBe(true);

    // A refetch that resolves to the SAME server data must not clobber the
    // in-progress edit. Flipping `useDraftState`'s `edited ? current : stored`
    // branch fails this assertion.
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ["personalization"] });
    });
    expect(result.current.draft?.preferredName).toBe("Leo (edited)");
  });

  it("trims text on save and stores an omitted-not-blank field as null", async () => {
    routeFetch();
    const { result } = renderDraft();

    await waitFor(() => expect(result.current.draft).not.toBeUndefined());

    act(() => {
      result.current.setField("preferredName", "   ");
      result.current.setField("about", "  Some text  ");
    });

    act(() => {
      result.current.save();
    });
    await waitFor(() => expect(result.current.update.isSuccess).toBe(true));

    const patchIndex = fetchMock.mock.calls.findIndex(
      ([reqArg]) => reqArg instanceof Request && reqArg.method === "PATCH",
    );
    expect(patchIndex).toBeGreaterThanOrEqual(0);
    const body = await requestFromCall(fetchMock, patchIndex).clone().json();
    // Blank-after-trim clears to null; surrounding whitespace is trimmed;
    // an untouched field is still included (toPatch maps every draft key).
    expect(body).toEqual({
      preferredName: null,
      about: "Some text",
      responsePreferences: profile.responsePreferences,
    });
  });

  it("flags isSaving only for a text-field save, not an unrelated toggle mutation", async () => {
    let resolvePatch!: (response: Response) => void;
    const pendingPatch = new Promise<Response>((resolve) => {
      resolvePatch = resolve;
    });
    routeFetch({ patchPersonalization: () => pendingPatch });
    const { result } = renderDraft();

    await waitFor(() => expect(result.current.draft).not.toBeUndefined());

    // A toggle write reuses the same mutation but never touches the capped
    // text fields — isSaving must stay false while it is pending. Replacing
    // the `key in update.variables` guard with a bare `update.isPending`
    // check would make this assertion fail.
    act(() => {
      result.current.update.mutate({ enabled: false });
    });
    await waitFor(() => expect(result.current.update.isPending).toBe(true));
    expect(result.current.isSaving).toBe(false);

    resolvePatch(jsonResponse({ ...profile, enabled: false }));
    await waitFor(() => expect(result.current.update.isPending).toBe(false));
  });

  it("flags isSaving true while a text-field save is pending", async () => {
    let resolvePatch!: (response: Response) => void;
    const pendingPatch = new Promise<Response>((resolve) => {
      resolvePatch = resolve;
    });
    routeFetch({ patchPersonalization: () => pendingPatch });
    const { result } = renderDraft();

    await waitFor(() => expect(result.current.draft).not.toBeUndefined());

    act(() => {
      result.current.setField("about", "New bio");
    });
    act(() => {
      result.current.save();
    });
    await waitFor(() => expect(result.current.isSaving).toBe(true));

    resolvePatch(jsonResponse(profile));
    await waitFor(() => expect(result.current.update.isPending).toBe(false));
  });

  it("marks a field over its character cap", async () => {
    routeFetch();
    const { result } = renderDraft();

    await waitFor(() => expect(result.current.draft).not.toBeUndefined());
    expect(result.current.overCap).toBe(false);

    act(() => {
      result.current.setField(
        "preferredName",
        "x".repeat(PERSONALIZATION_CAPS.preferredName + 1),
      );
    });
    expect(result.current.overCap).toBe(true);
  });

  it("holds the preview undefined while account identity is shared but unresolved, then renders it once the account loads", async () => {
    let resolveMe!: (response: Response) => void;
    const pendingMe = new Promise<Response>((resolve) => {
      resolveMe = resolve;
    });
    routeFetch({
      getPersonalization: () =>
        jsonResponse({ ...profile, shareAccountIdentity: true }),
      getMe: () => pendingMe,
    });
    const { result } = renderDraft();

    await waitFor(() => expect(result.current.draft).not.toBeUndefined());
    // `me` is still in flight: rendering a preview here would understate what
    // the model actually receives once the identity resolves.
    expect(result.current.preview).toBeUndefined();

    resolveMe(jsonResponse(account));
    await waitFor(() => expect(result.current.preview).not.toBeUndefined());
    expect(result.current.preview?.text).toContain(
      `Account name: ${account.name}`,
    );
  });
});
