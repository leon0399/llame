// @vitest-environment jsdom

import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

let fetchMock: Mock<typeof fetch>;

/**
 * Assert the request the generated endpoint actually sent. The previous
 * version asserted only that a mocked endpoint function had been called with
 * certain arguments, so each test's own name — "POSTs /org-units/:id/children"
 * — was never checked against anything.
 */
async function expectRequest(expected: {
  method: string;
  pathname: string;
  body?: unknown;
}) {
  const request = requestFromCall(fetchMock);
  expect(request.method).toBe(expected.method);
  expect(new URL(request.url).pathname).toBe(expected.pathname);
  expect(request.credentials).toBe("include");
  if (expected.body !== undefined) {
    await expect(request.json()).resolves.toEqual(expected.body);
  }
}

beforeEach(() => {
  fetchMock = stubFetch();
});

import {
  changeMembershipRole,
  createChildOrg,
  createRootOrg,
  deleteOrgUnit,
  grantMembership,
  revokeMembership,
  updateOrgUnit,
  useChangeMembershipRole,
  useCreateChildOrg,
  useCreateRootOrg,
  useDeleteOrgUnit,
  useGrantMembership,
  useRevokeMembership,
  useUpdateOrgUnit,
} from "./mutations";
import { orgUnitsQueryKeys } from "./queries";
import {
  emptyResponse,
  jsonResponse,
  requestFromCall,
  stubFetch,
} from "../../test-support/fetch-stub";
import type { MembershipResponse, OrgUnitResponse } from "./types";

/** A promise plus externally-callable resolve/reject, to hold a mocked
 * fetcher open so an optimistic patch can be observed before it settles. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function orgUnitFixture(
  overrides: Partial<OrgUnitResponse> = {},
): OrgUnitResponse {
  return {
    id: "u1",
    parentId: null,
    name: "Acme",
    type: "organization",
    path: "u1",
    settings: {},
    createdAt: "2026-01-01T00:00:00.000Z",
    memberCount: 1,
    directRole: "owner",
    ...overrides,
  };
}

function membershipFixture(
  overrides: Partial<MembershipResponse> = {},
): MembershipResponse {
  return {
    id: "m1",
    userId: "user-2",
    orgUnitId: "u1",
    role: "member",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function wrapperWithClient(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(
      QueryClientProvider,
      { client: queryClient },
      children,
    );
  };
}

function newTestQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createRootOrg", () => {
  it("POSTs /org-units with just the name (the API defaults roots to 'organization')", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: "u1" }));
    await createRootOrg({ name: "Acme" });
    await expectRequest({
      method: "POST",
      pathname: "/api/v1/org-units",
      body: { name: "Acme" },
    });
  });
});

describe("createChildOrg", () => {
  it("POSTs /org-units/:id/children with the name", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: "u2" }));
    await createChildOrg({ parentId: "parent-1", name: "Team" });
    await expectRequest({
      method: "POST",
      pathname: "/api/v1/org-units/parent-1/children",
      body: { name: "Team" },
    });
  });

  it("includes the type when the child dialog's type segment picked one", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: "u3" }));
    await createChildOrg({
      parentId: "parent-1",
      name: "Design",
      type: "department",
    });
    await expectRequest({
      method: "POST",
      pathname: "/api/v1/org-units/parent-1/children",
      body: { name: "Design", type: "department" },
    });
  });
});

describe("updateOrgUnit", () => {
  it("PATCHes /org-units/:id with only the provided fields", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: "u1" }));
    await updateOrgUnit({ orgUnitId: "u1", name: "Renamed" });
    await expectRequest({
      method: "PATCH",
      pathname: "/api/v1/org-units/u1",
      body: { name: "Renamed" },
    });
  });

  it("passes an explicit null parentId through (move to root)", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: "u1" }));
    await updateOrgUnit({ orgUnitId: "u1", parentId: null });
    await expectRequest({
      method: "PATCH",
      pathname: "/api/v1/org-units/u1",
      body: { parentId: null },
    });
  });
});

describe("deleteOrgUnit", () => {
  it("DELETEs /org-units/:id", async () => {
    fetchMock.mockResolvedValue(emptyResponse());
    await deleteOrgUnit("u1");
    await expectRequest({ method: "DELETE", pathname: "/api/v1/org-units/u1" });
  });
});

describe("grantMembership", () => {
  it("POSTs /org-units/:id/memberships with userId + role", async () => {
    fetchMock.mockResolvedValue(emptyResponse());
    await grantMembership({ orgUnitId: "u1", userId: "user-2", role: "admin" });
    await expectRequest({
      method: "POST",
      pathname: "/api/v1/org-units/u1/memberships",
      body: { userId: "user-2", role: "admin" },
    });
  });
});

describe("changeMembershipRole", () => {
  it("PATCHes /org-units/:id/memberships/:userId with the role", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: "m1" }));
    await changeMembershipRole({
      orgUnitId: "u1",
      userId: "user-2",
      role: "owner",
    });
    await expectRequest({
      method: "PATCH",
      pathname: "/api/v1/org-units/u1/memberships/user-2",
      body: { role: "owner" },
    });
  });
});

describe("revokeMembership", () => {
  it("DELETEs /org-units/:id/memberships/:userId", async () => {
    fetchMock.mockResolvedValue(emptyResponse());
    await revokeMembership({ orgUnitId: "u1", userId: "user-2" });
    await expectRequest({
      method: "DELETE",
      pathname: "/api/v1/org-units/u1/memberships/user-2",
    });
  });
});

describe("useUpdateOrgUnit: optimistic cache patch", () => {
  it("patches the name in lists() before the fetcher resolves, then invalidates", async () => {
    const queryClient = newTestQueryClient();
    const seeded = [orgUnitFixture({ id: "u1", name: "Old" })];
    queryClient.setQueryData(orgUnitsQueryKeys.lists(), seeded);
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { promise, resolve } = deferred<Response>();
    fetchMock.mockReturnValue(promise);

    const { result } = renderHook(() => useUpdateOrgUnit(), {
      wrapper: wrapperWithClient(queryClient),
    });
    result.current.mutate({ orgUnitId: "u1", name: "New" });

    // The patch lands after onMutate's `await cancelQueries(...)` resolves —
    // a synchronous read here would still see the old snapshot.
    await waitFor(() =>
      expect(
        queryClient.getQueryData<Array<OrgUnitResponse>>(
          orgUnitsQueryKeys.lists(),
        ),
      ).toMatchObject([{ id: "u1", name: "New" }]),
    );
    expect(invalidateSpy).not.toHaveBeenCalled();

    resolve(jsonResponse(orgUnitFixture({ id: "u1", name: "New" })));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: orgUnitsQueryKeys.lists(),
    });
  });

  it("rolls back to the snapshot on error, and still invalidates via onSettled", async () => {
    const queryClient = newTestQueryClient();
    const seeded = [orgUnitFixture({ id: "u1", name: "Old" })];
    queryClient.setQueryData(orgUnitsQueryKeys.lists(), seeded);
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { promise, reject } = deferred<Response>();
    fetchMock.mockReturnValue(promise);

    const { result } = renderHook(() => useUpdateOrgUnit(), {
      wrapper: wrapperWithClient(queryClient),
    });
    result.current.mutate({ orgUnitId: "u1", name: "New" });

    await waitFor(() =>
      expect(
        queryClient.getQueryData<Array<OrgUnitResponse>>(
          orgUnitsQueryKeys.lists(),
        ),
      ).toMatchObject([{ name: "New" }]),
    );

    reject(new Error("network down"));
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(
      queryClient.getQueryData<Array<OrgUnitResponse>>(
        orgUnitsQueryKeys.lists(),
      ),
    ).toEqual(seeded);
    // onSettled always invalidates, success or failure (concurrent-reorg
    // auto-refetch requirement) — no dedicated onError invalidation needed.
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: orgUnitsQueryKeys.lists(),
    });
  });
});

describe("useDeleteOrgUnit: optimistic cache patch", () => {
  it("removes the unit from lists() before the fetcher resolves", async () => {
    const queryClient = newTestQueryClient();
    const seeded = [
      orgUnitFixture({ id: "u1" }),
      orgUnitFixture({ id: "u2", name: "Keep me" }),
    ];
    queryClient.setQueryData(orgUnitsQueryKeys.lists(), seeded);

    const { promise, resolve } = deferred<Response>();
    fetchMock.mockReturnValue(promise);

    const { result } = renderHook(() => useDeleteOrgUnit(), {
      wrapper: wrapperWithClient(queryClient),
    });
    result.current.mutate("u1");

    await waitFor(() =>
      expect(
        queryClient.getQueryData<Array<OrgUnitResponse>>(
          orgUnitsQueryKeys.lists(),
        ),
      ).toEqual([expect.objectContaining({ id: "u2" })]),
    );

    resolve(emptyResponse());
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it("restores the snapshot when the delete is rejected", async () => {
    const queryClient = newTestQueryClient();
    const seeded = [orgUnitFixture({ id: "u1" }), orgUnitFixture({ id: "u2" })];
    queryClient.setQueryData(orgUnitsQueryKeys.lists(), seeded);

    const { promise, reject } = deferred<Response>();
    fetchMock.mockReturnValue(promise);

    const { result } = renderHook(() => useDeleteOrgUnit(), {
      wrapper: wrapperWithClient(queryClient),
    });
    result.current.mutate("u1");

    await waitFor(() =>
      expect(
        queryClient.getQueryData<Array<OrgUnitResponse>>(
          orgUnitsQueryKeys.lists(),
        ),
      ).toHaveLength(1),
    );

    reject(new Error("network down"));
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(
      queryClient.getQueryData<Array<OrgUnitResponse>>(
        orgUnitsQueryKeys.lists(),
      ),
    ).toEqual(seeded);
  });
});

describe("useChangeMembershipRole: optimistic cache patch", () => {
  it("patches the membership's role in memberships() before the fetcher resolves", async () => {
    const queryClient = newTestQueryClient();
    const seeded = [membershipFixture({ userId: "user-2", role: "member" })];
    queryClient.setQueryData(orgUnitsQueryKeys.memberships("u1"), seeded);

    const { promise, resolve } = deferred<Response>();
    fetchMock.mockReturnValue(promise);

    const { result } = renderHook(() => useChangeMembershipRole(), {
      wrapper: wrapperWithClient(queryClient),
    });
    result.current.mutate({ orgUnitId: "u1", userId: "user-2", role: "owner" });

    await waitFor(() =>
      expect(
        queryClient.getQueryData<Array<MembershipResponse>>(
          orgUnitsQueryKeys.memberships("u1"),
        ),
      ).toMatchObject([{ userId: "user-2", role: "owner" }]),
    );

    resolve(
      jsonResponse(membershipFixture({ userId: "user-2", role: "owner" })),
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it("rolls back the membership role on error", async () => {
    const queryClient = newTestQueryClient();
    const seeded = [membershipFixture({ userId: "user-2", role: "member" })];
    queryClient.setQueryData(orgUnitsQueryKeys.memberships("u1"), seeded);

    const { promise, reject } = deferred<Response>();
    fetchMock.mockReturnValue(promise);

    const { result } = renderHook(() => useChangeMembershipRole(), {
      wrapper: wrapperWithClient(queryClient),
    });
    result.current.mutate({ orgUnitId: "u1", userId: "user-2", role: "owner" });

    await waitFor(() =>
      expect(
        queryClient.getQueryData<Array<MembershipResponse>>(
          orgUnitsQueryKeys.memberships("u1"),
        ),
      ).toMatchObject([{ role: "owner" }]),
    );

    reject(new Error("network down"));
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(
      queryClient.getQueryData<Array<MembershipResponse>>(
        orgUnitsQueryKeys.memberships("u1"),
      ),
    ).toEqual(seeded);
  });
});

describe("useCreateRootOrg: no optimistic insert", () => {
  it("leaves lists() untouched until success, then only invalidates (never patches a guessed row in)", async () => {
    const queryClient = newTestQueryClient();
    const seeded = [orgUnitFixture({ id: "u1" })];
    queryClient.setQueryData(orgUnitsQueryKeys.lists(), seeded);
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { promise, resolve } = deferred<Response>();
    fetchMock.mockReturnValue(promise);

    const { result } = renderHook(() => useCreateRootOrg(), {
      wrapper: wrapperWithClient(queryClient),
    });
    result.current.mutate({ name: "New Co" });

    // Still pending — the server hasn't assigned id/path yet, so there is
    // nothing correct to have patched in.
    expect(
      queryClient.getQueryData<Array<OrgUnitResponse>>(
        orgUnitsQueryKeys.lists(),
      ),
    ).toEqual(seeded);
    expect(invalidateSpy).not.toHaveBeenCalled();

    resolve(jsonResponse(orgUnitFixture({ id: "u2", name: "New Co" })));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // Cache data itself is unchanged here (nothing refetches it without a
    // mounted observer) — what matters is that invalidation, not a patch,
    // is what drives the eventual update.
    expect(
      queryClient.getQueryData<Array<OrgUnitResponse>>(
        orgUnitsQueryKeys.lists(),
      ),
    ).toEqual(seeded);
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: orgUnitsQueryKeys.lists(),
    });
  });
});

describe("useUpdateOrgUnit: patches only the matching row", () => {
  it("leaves a sibling unit's fields untouched (applyOrgUnitPatch's id-mismatch branch)", async () => {
    const queryClient = newTestQueryClient();
    const seeded = [
      orgUnitFixture({ id: "u1", name: "Old" }),
      orgUnitFixture({ id: "u2", name: "Sibling" }),
    ];
    queryClient.setQueryData(orgUnitsQueryKeys.lists(), seeded);
    fetchMock.mockResolvedValue(
      jsonResponse(orgUnitFixture({ id: "u1", name: "New" })),
    );

    const { result } = renderHook(() => useUpdateOrgUnit(), {
      wrapper: wrapperWithClient(queryClient),
    });
    result.current.mutate({ orgUnitId: "u1", name: "New" });

    await waitFor(() =>
      expect(
        queryClient.getQueryData<Array<OrgUnitResponse>>(
          orgUnitsQueryKeys.lists(),
        ),
      ).toMatchObject([
        { id: "u1", name: "New" },
        { id: "u2", name: "Sibling" },
      ]),
    );
  });
});

describe("useCreateChildOrg: hook invalidates lists() on success", () => {
  it("POSTs the child and invalidates lists() only after the fetcher resolves", async () => {
    const queryClient = newTestQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const { promise, resolve } = deferred<Response>();
    fetchMock.mockReturnValue(promise);

    const { result } = renderHook(() => useCreateChildOrg(), {
      wrapper: wrapperWithClient(queryClient),
    });
    result.current.mutate({ parentId: "u1", name: "Team" });

    expect(invalidateSpy).not.toHaveBeenCalled();
    resolve(jsonResponse(orgUnitFixture({ id: "u2", name: "Team" })));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: orgUnitsQueryKeys.lists(),
    });
  });
});

describe("useGrantMembership: invalidates memberships() and myRole()", () => {
  it("grants and invalidates both keys for the target unit (the creator-visibility edge)", async () => {
    const queryClient = newTestQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    fetchMock.mockResolvedValue(emptyResponse());

    const { result } = renderHook(() => useGrantMembership(), {
      wrapper: wrapperWithClient(queryClient),
    });
    result.current.mutate({ orgUnitId: "u1", userId: "user-2", role: "admin" });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: orgUnitsQueryKeys.memberships("u1"),
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: orgUnitsQueryKeys.myRole("u1"),
    });
  });
});

describe("useRevokeMembership: optimistic removal + rollback + invalidation", () => {
  it("removes the membership from the cache before the fetcher resolves, then invalidates myRole and lists (self-leave)", async () => {
    const queryClient = newTestQueryClient();
    const seeded = [
      membershipFixture({ userId: "user-2" }),
      membershipFixture({ userId: "user-3" }),
    ];
    queryClient.setQueryData(orgUnitsQueryKeys.memberships("u1"), seeded);
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const { promise, resolve } = deferred<Response>();
    fetchMock.mockReturnValue(promise);

    const { result } = renderHook(() => useRevokeMembership(), {
      wrapper: wrapperWithClient(queryClient),
    });
    result.current.mutate({ orgUnitId: "u1", userId: "user-2" });

    await waitFor(() =>
      expect(
        queryClient.getQueryData<Array<MembershipResponse>>(
          orgUnitsQueryKeys.memberships("u1"),
        ),
      ).toEqual([expect.objectContaining({ userId: "user-3" })]),
    );

    resolve(emptyResponse());
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: orgUnitsQueryKeys.myRole("u1"),
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: orgUnitsQueryKeys.lists(),
    });
  });

  it("rolls back the removed membership on error", async () => {
    const queryClient = newTestQueryClient();
    const seeded = [membershipFixture({ userId: "user-2" })];
    queryClient.setQueryData(orgUnitsQueryKeys.memberships("u1"), seeded);
    const { promise, reject } = deferred<Response>();
    fetchMock.mockReturnValue(promise);

    const { result } = renderHook(() => useRevokeMembership(), {
      wrapper: wrapperWithClient(queryClient),
    });
    result.current.mutate({ orgUnitId: "u1", userId: "user-2" });

    await waitFor(() =>
      expect(
        queryClient.getQueryData<Array<MembershipResponse>>(
          orgUnitsQueryKeys.memberships("u1"),
        ),
      ).toEqual([]),
    );

    reject(new Error("network down"));
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(
      queryClient.getQueryData<Array<MembershipResponse>>(
        orgUnitsQueryKeys.memberships("u1"),
      ),
    ).toEqual(seeded);
  });
});

describe("optimistic mutations: empty-cache edge", () => {
  it("useUpdateOrgUnit doesn't throw when lists() was never fetched", async () => {
    const queryClient = newTestQueryClient();
    fetchMock.mockResolvedValue(jsonResponse(orgUnitFixture({ id: "u1" })));

    const { result } = renderHook(() => useUpdateOrgUnit(), {
      wrapper: wrapperWithClient(queryClient),
    });
    result.current.mutate({ orgUnitId: "u1", name: "New" });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(queryClient.getQueryData(orgUnitsQueryKeys.lists())).toBeUndefined();
  });

  it("useDeleteOrgUnit doesn't throw when lists() was never fetched", async () => {
    const queryClient = newTestQueryClient();
    fetchMock.mockResolvedValue(emptyResponse());

    const { result } = renderHook(() => useDeleteOrgUnit(), {
      wrapper: wrapperWithClient(queryClient),
    });
    result.current.mutate("u1");

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(queryClient.getQueryData(orgUnitsQueryKeys.lists())).toBeUndefined();
  });
});
