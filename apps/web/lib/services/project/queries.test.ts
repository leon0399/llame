import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";

import { fetchProjects, projectQueryKeys } from "./queries";
import {
  jsonResponse,
  requestFromCall,
  stubFetch,
} from "../../test-support/fetch-stub";

let fetchMock: Mock<typeof fetch>;

beforeEach(() => {
  fetchMock = stubFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
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
    fetchMock.mockResolvedValue(jsonResponse([{ id: "p1" }]));
    await fetchProjects();

    const request = requestFromCall(fetchMock);
    expect(request.method).toBe("GET");
    expect(new URL(request.url).pathname).toBe("/api/v1/projects");
    expect(new URL(request.url).search).toBe("");
    expect(request.credentials).toBe("include");
  });

  it("passes server filters to the generated endpoint", async () => {
    fetchMock.mockResolvedValue(jsonResponse([]));
    const filters = { pinned: "only" as const, archived: "with" as const };

    await fetchProjects(filters);

    const request = requestFromCall(fetchMock);
    const params = new URL(request.url).searchParams;
    expect(params.get("pinned")).toBe("only");
    expect(params.get("archived")).toBe("with");
  });
});
