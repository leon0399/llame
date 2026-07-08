import { afterEach, describe, expect, it, vi } from "vitest";

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
} from "./mutations";

function jsonResolved<T>(value: T) {
  return { json: () => Promise.resolve(value) };
}

afterEach(() => {
  post.mockReset();
  patch.mockReset();
  del.mockReset();
});

describe("createRootOrg", () => {
  it("POSTs /org-units with the name", async () => {
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
