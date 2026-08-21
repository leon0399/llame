import { afterEach, describe, expect, it, vi } from "vitest";

const listProjectsEndpoint = vi.hoisted(() => vi.fn());
const authenticatedFetch = vi.hoisted(() => vi.fn());
const createAuthenticatedBrowserFetch = vi.hoisted(() => vi.fn());

vi.mock("../../api/generated/projects/projects", () => ({
  listProjects: listProjectsEndpoint,
}));
vi.mock("../../api/fetch", () => ({
  createAuthenticatedBrowserFetch,
}));

import { fetchProjects, projectQueryKeys } from "./queries";

createAuthenticatedBrowserFetch.mockReturnValue(authenticatedFetch);

afterEach(() => {
  vi.clearAllMocks();
  createAuthenticatedBrowserFetch.mockReturnValue(authenticatedFetch);
});

describe("projectQueryKeys", () => {
  it("uses resource-path query keys", () => {
    expect(projectQueryKeys.all).toEqual(["projects"]);
    expect(projectQueryKeys.lists()).toEqual(["projects", "list"]);
    expect(projectQueryKeys.filtered()).toEqual(["projects", "list"]);
    expect(
      projectQueryKeys.filtered({ pinned: "only", archived: "with" }),
    ).toEqual(["projects", "list", { pinned: "only", archived: "with" }]);
  });
});

describe("fetchProjects", () => {
  it("lists projects through the generated authenticated endpoint", async () => {
    listProjectsEndpoint.mockResolvedValue([{ id: "p1" }]);
    await fetchProjects();
    expect(listProjectsEndpoint).toHaveBeenCalledWith(
      undefined,
      undefined,
      authenticatedFetch,
    );
    expect(createAuthenticatedBrowserFetch).toHaveBeenCalledWith(
      globalThis.fetch,
    );
  });

  it("passes server filters to the generated endpoint", async () => {
    listProjectsEndpoint.mockResolvedValue([]);
    const filters = { pinned: "only" as const, archived: "with" as const };

    await fetchProjects(filters);

    expect(listProjectsEndpoint).toHaveBeenCalledWith(
      filters,
      undefined,
      authenticatedFetch,
    );
  });
});
