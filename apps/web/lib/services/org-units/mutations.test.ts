// @vitest-environment jsdom

import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const { post, patch, del } = vi.hoisted(() => ({
  post: vi.fn(),
  patch: vi.fn(),
  del: vi.fn(),
}));

vi.mock("../../api/client", () => ({
  api: { post, patch, delete: del },
  buildApiUrl: (path: string) => `http://api${path}`,
}));

import {
  changeMembershipRole,
  createChildOrg,
  createRootOrg,
  deleteOrgUnit,
  grantMembership,
  revokeMembership,
  updateOrgUnit,
  useChangeMembershipRole,
  useCreateRootOrg,
  useDeleteOrgUnit,
  useUpdateOrgUnit,
} from "./mutations";
import { orgUnitsQueryKeys } from "./queries";
import type { MembershipResponse, OrgUnitResponse } from "./types";

function jsonResolved<T>(value: T) {
  return { json: () => Promise.resolve(value) };
}

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
  post.mockReset();
  patch.mockReset();
  del.mockReset();
});

describe("createRootOrg", () => {
  it("POSTs /org-units with just the name (the API defaults roots to 'organization')", async () => {
    post.mockReturnValue(jsonResolved({ id: "u1" }));
    await createRootOrg({ name: "Acme" });
    expect(post).toHaveBeenCalledWith("http://api/api/v1/org-units", {
      json: { name: "Acme" },
    });
  });
});

describe("createChildOrg", () => {
  it("POSTs /org-units/:id/children with the name", async () => {
    post.mockReturnValue(jsonResolved({ id: "u2" }));
    await createChildOrg({ parentId: "parent-1", name: "Team" });
    expect(post).toHaveBeenCalledWith(
      "http://api/api/v1/org-units/parent-1/children",
      { json: { name: "Team" } },
    );
  });

  it("includes the type when the child dialog's type segment picked one", () => {
    post.mockReturnValue(jsonResolved({ id: "u3" }));
    void createChildOrg({
      parentId: "parent-1",
      name: "Design",
      type: "department",
    });
    expect(post).toHaveBeenCalledWith(
      "http://api/api/v1/org-units/parent-1/children",
      { json: { name: "Design", type: "department" } },
    );
  });
});

describe("updateOrgUnit", () => {
  it("PATCHes /org-units/:id with only the provided fields", async () => {
    patch.mockReturnValue(jsonResolved({ id: "u1" }));
    await updateOrgUnit({ orgUnitId: "u1", name: "Renamed" });
    expect(patch).toHaveBeenCalledWith("http://api/api/v1/org-units/u1", {
      json: { name: "Renamed" },
    });
  });

  it("passes an explicit null parentId through (move to root)", async () => {
    patch.mockReturnValue(jsonResolved({ id: "u1" }));
    await updateOrgUnit({ orgUnitId: "u1", parentId: null });
    expect(patch).toHaveBeenCalledWith("http://api/api/v1/org-units/u1", {
      json: { parentId: null },
    });
  });
});

describe("deleteOrgUnit", () => {
  it("DELETEs /org-units/:id", async () => {
    del.mockResolvedValue(undefined);
    await deleteOrgUnit("u1");
    expect(del).toHaveBeenCalledWith("http://api/api/v1/org-units/u1");
  });
});

describe("grantMembership", () => {
  it("POSTs /org-units/:id/memberships with userId + role", async () => {
    post.mockResolvedValue(undefined);
    await grantMembership({ orgUnitId: "u1", userId: "user-2", role: "admin" });
    expect(post).toHaveBeenCalledWith(
      "http://api/api/v1/org-units/u1/memberships",
      { json: { userId: "user-2", role: "admin" } },
    );
  });
});

describe("changeMembershipRole", () => {
  it("PATCHes /org-units/:id/memberships/:userId with the role", async () => {
    patch.mockReturnValue(jsonResolved({ id: "m1" }));
    await changeMembershipRole({
      orgUnitId: "u1",
      userId: "user-2",
      role: "owner",
    });
    expect(patch).toHaveBeenCalledWith(
      "http://api/api/v1/org-units/u1/memberships/user-2",
      { json: { role: "owner" } },
    );
  });
});

describe("revokeMembership", () => {
  it("DELETEs /org-units/:id/memberships/:userId", async () => {
    del.mockResolvedValue(undefined);
    await revokeMembership({ orgUnitId: "u1", userId: "user-2" });
    expect(del).toHaveBeenCalledWith(
      "http://api/api/v1/org-units/u1/memberships/user-2",
    );
  });
});

describe("useUpdateOrgUnit: optimistic cache patch", () => {
  it("patches the name in lists() before the fetcher resolves, then invalidates", async () => {
    const queryClient = newTestQueryClient();
    const seeded = [orgUnitFixture({ id: "u1", name: "Old" })];
    queryClient.setQueryData(orgUnitsQueryKeys.lists(), seeded);
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { promise, resolve } = deferred<OrgUnitResponse>();
    patch.mockReturnValue({ json: () => promise });

    const { result } = renderHook(() => useUpdateOrgUnit(), {
      wrapper: wrapperWithClient(queryClient),
    });
    result.current.mutate({ orgUnitId: "u1", name: "New" });

    // The patch lands after onMutate's `await cancelQueries(...)` resolves —
    // a synchronous read here would still see the old snapshot.
    await waitFor(() =>
      expect(
        queryClient.getQueryData<OrgUnitResponse[]>(orgUnitsQueryKeys.lists()),
      ).toMatchObject([{ id: "u1", name: "New" }]),
    );
    expect(invalidateSpy).not.toHaveBeenCalled();

    resolve(orgUnitFixture({ id: "u1", name: "New" }));
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

    const { promise, reject } = deferred<OrgUnitResponse>();
    patch.mockReturnValue({ json: () => promise });

    const { result } = renderHook(() => useUpdateOrgUnit(), {
      wrapper: wrapperWithClient(queryClient),
    });
    result.current.mutate({ orgUnitId: "u1", name: "New" });

    await waitFor(() =>
      expect(
        queryClient.getQueryData<OrgUnitResponse[]>(orgUnitsQueryKeys.lists()),
      ).toMatchObject([{ name: "New" }]),
    );

    reject(new Error("network down"));
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(
      queryClient.getQueryData<OrgUnitResponse[]>(orgUnitsQueryKeys.lists()),
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

    const { promise, resolve } = deferred<void>();
    del.mockReturnValue(promise);

    const { result } = renderHook(() => useDeleteOrgUnit(), {
      wrapper: wrapperWithClient(queryClient),
    });
    result.current.mutate("u1");

    await waitFor(() =>
      expect(
        queryClient.getQueryData<OrgUnitResponse[]>(orgUnitsQueryKeys.lists()),
      ).toEqual([expect.objectContaining({ id: "u2" })]),
    );

    resolve();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it("restores the snapshot when the delete is rejected", async () => {
    const queryClient = newTestQueryClient();
    const seeded = [orgUnitFixture({ id: "u1" }), orgUnitFixture({ id: "u2" })];
    queryClient.setQueryData(orgUnitsQueryKeys.lists(), seeded);

    const { promise, reject } = deferred<void>();
    del.mockReturnValue(promise);

    const { result } = renderHook(() => useDeleteOrgUnit(), {
      wrapper: wrapperWithClient(queryClient),
    });
    result.current.mutate("u1");

    await waitFor(() =>
      expect(
        queryClient.getQueryData<OrgUnitResponse[]>(orgUnitsQueryKeys.lists()),
      ).toHaveLength(1),
    );

    reject(new Error("network down"));
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(
      queryClient.getQueryData<OrgUnitResponse[]>(orgUnitsQueryKeys.lists()),
    ).toEqual(seeded);
  });
});

describe("useChangeMembershipRole: optimistic cache patch", () => {
  it("patches the membership's role in memberships() before the fetcher resolves", async () => {
    const queryClient = newTestQueryClient();
    const seeded = [membershipFixture({ userId: "user-2", role: "member" })];
    queryClient.setQueryData(orgUnitsQueryKeys.memberships("u1"), seeded);

    const { promise, resolve } = deferred<MembershipResponse>();
    patch.mockReturnValue({ json: () => promise });

    const { result } = renderHook(() => useChangeMembershipRole(), {
      wrapper: wrapperWithClient(queryClient),
    });
    result.current.mutate({ orgUnitId: "u1", userId: "user-2", role: "owner" });

    await waitFor(() =>
      expect(
        queryClient.getQueryData<MembershipResponse[]>(
          orgUnitsQueryKeys.memberships("u1"),
        ),
      ).toMatchObject([{ userId: "user-2", role: "owner" }]),
    );

    resolve(membershipFixture({ userId: "user-2", role: "owner" }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it("rolls back the membership role on error", async () => {
    const queryClient = newTestQueryClient();
    const seeded = [membershipFixture({ userId: "user-2", role: "member" })];
    queryClient.setQueryData(orgUnitsQueryKeys.memberships("u1"), seeded);

    const { promise, reject } = deferred<MembershipResponse>();
    patch.mockReturnValue({ json: () => promise });

    const { result } = renderHook(() => useChangeMembershipRole(), {
      wrapper: wrapperWithClient(queryClient),
    });
    result.current.mutate({ orgUnitId: "u1", userId: "user-2", role: "owner" });

    await waitFor(() =>
      expect(
        queryClient.getQueryData<MembershipResponse[]>(
          orgUnitsQueryKeys.memberships("u1"),
        ),
      ).toMatchObject([{ role: "owner" }]),
    );

    reject(new Error("network down"));
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(
      queryClient.getQueryData<MembershipResponse[]>(
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

    const { promise, resolve } = deferred<OrgUnitResponse>();
    post.mockReturnValue({ json: () => promise });

    const { result } = renderHook(() => useCreateRootOrg(), {
      wrapper: wrapperWithClient(queryClient),
    });
    result.current.mutate({ name: "New Co" });

    // Still pending — the server hasn't assigned id/path yet, so there is
    // nothing correct to have patched in.
    expect(
      queryClient.getQueryData<OrgUnitResponse[]>(orgUnitsQueryKeys.lists()),
    ).toEqual(seeded);
    expect(invalidateSpy).not.toHaveBeenCalled();

    resolve(orgUnitFixture({ id: "u2", name: "New Co" }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // Cache data itself is unchanged here (nothing refetches it without a
    // mounted observer) — what matters is that invalidation, not a patch,
    // is what drives the eventual update.
    expect(
      queryClient.getQueryData<OrgUnitResponse[]>(orgUnitsQueryKeys.lists()),
    ).toEqual(seeded);
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: orgUnitsQueryKeys.lists(),
    });
  });
});

describe("optimistic mutations: empty-cache edge", () => {
  it("useUpdateOrgUnit doesn't throw when lists() was never fetched", async () => {
    const queryClient = newTestQueryClient();
    patch.mockReturnValue(jsonResolved(orgUnitFixture({ id: "u1" })));

    const { result } = renderHook(() => useUpdateOrgUnit(), {
      wrapper: wrapperWithClient(queryClient),
    });
    result.current.mutate({ orgUnitId: "u1", name: "New" });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(queryClient.getQueryData(orgUnitsQueryKeys.lists())).toBeUndefined();
  });

  it("useDeleteOrgUnit doesn't throw when lists() was never fetched", async () => {
    const queryClient = newTestQueryClient();
    del.mockResolvedValue(undefined);

    const { result } = renderHook(() => useDeleteOrgUnit(), {
      wrapper: wrapperWithClient(queryClient),
    });
    result.current.mutate("u1");

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(queryClient.getQueryData(orgUnitsQueryKeys.lists())).toBeUndefined();
  });
});
