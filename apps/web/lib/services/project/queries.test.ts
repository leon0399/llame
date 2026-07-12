import { afterEach, describe, expect, it, vi } from "vitest";

const { get } = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock("../../api/client", () => ({
  api: { get },
  buildApiUrl: (path: string) => `http://api${path}`,
}));

import { fetchProjects, projectQueryKeys } from "./queries";

function jsonResolved<T>(value: T) {
  return { json: () => Promise.resolve(value) };
}

afterEach(() => {
  get.mockReset();
});

describe("projectQueryKeys", () => {
  it("uses resource-path query keys", () => {
    expect(projectQueryKeys.all).toEqual(["projects"]);
    expect(projectQueryKeys.lists()).toEqual(["projects", "list"]);
  });
});

describe("fetchProjects", () => {
  it("GETs /projects", async () => {
    get.mockReturnValue(jsonResolved([{ id: "p1" }]));
    await fetchProjects();
    expect(get).toHaveBeenCalledWith("http://api/api/v1/projects");
  });
});
