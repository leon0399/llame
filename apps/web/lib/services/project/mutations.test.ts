import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";

import {
  createProject,
  deleteProject,
  fileChat,
  linkProjectRepository,
  setProjectArchive,
  unlinkProjectRepository,
  updateProject,
  updateProjectRepositoryLink,
} from "./mutations";
import {
  emptyResponse,
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

describe("createProject", () => {
  it("POSTs /projects with the name and the description", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: "p1" }));
    await createProject({ name: "Acme", description: "The relaunch" });

    const request = requestFromCall(fetchMock);
    expect(request.method).toBe("POST");
    expect(new URL(request.url).pathname).toBe("/api/v1/projects");
    await expect(request.clone().json()).resolves.toEqual({
      name: "Acme",
      description: "The relaunch",
    });
  });
});

describe("updateProject", () => {
  it("PATCHes /projects/:id with the name and the description", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: "p1" }));
    await updateProject("p1", {
      name: "Renamed",
      description: "Acme relaunch",
    });

    const request = requestFromCall(fetchMock);
    expect(request.method).toBe("PATCH");
    expect(new URL(request.url).pathname).toBe("/api/v1/projects/p1");
    await expect(request.clone().json()).resolves.toEqual({
      name: "Renamed",
      description: "Acme relaunch",
    });
  });
});

describe("setProjectArchive", () => {
  it("PATCHes /projects/:id with the archive state", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: "p1" }));
    await setProjectArchive("p1", true);

    const request = requestFromCall(fetchMock);
    expect(request.method).toBe("PATCH");
    expect(new URL(request.url).pathname).toBe("/api/v1/projects/p1");
    await expect(request.clone().json()).resolves.toEqual({ archived: true });
  });
});

describe("deleteProject", () => {
  it("DELETEs /projects/:id", async () => {
    fetchMock.mockResolvedValue(emptyResponse());
    await deleteProject("p1");

    const request = requestFromCall(fetchMock);
    expect(request.method).toBe("DELETE");
    expect(new URL(request.url).pathname).toBe("/api/v1/projects/p1");
  });

  it("swallows a 404 (already deleted) as success", async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, 404));
    await expect(deleteProject("gone")).resolves.toBeUndefined();
  });

  it("rethrows non-404 errors", async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, 500));
    await expect(deleteProject("p1")).rejects.toMatchObject({ status: 500 });
  });
});

describe("fileChat", () => {
  it("updates the chat through the generated endpoint when filing it", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: "c1" }));
    await fileChat("c1", "p1");

    const request = requestFromCall(fetchMock);
    expect(request.method).toBe("PATCH");
    expect(new URL(request.url).pathname).toBe("/api/v1/chats/c1");
    await expect(request.clone().json()).resolves.toEqual({
      projectId: "p1",
    });
  });

  it("updates the chat with null when unfiling it", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: "c1" }));
    await fileChat("c1", null);

    const request = requestFromCall(fetchMock);
    await expect(request.clone().json()).resolves.toEqual({
      projectId: null,
    });
  });
});

describe("linkProjectRepository", () => {
  it("POSTs the link with the alias, primary flag, and policy", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: "l1" }, 201));
    await linkProjectRepository({
      projectId: "p1",
      repositoryId: "r1",
      alias: "llame",
      isPrimary: true,
      isolation: "always_worktree",
    });

    const request = requestFromCall(fetchMock);
    expect(request.method).toBe("POST");
    expect(new URL(request.url).pathname).toBe(
      "/api/v1/projects/p1/repositories",
    );
    await expect(request.clone().json()).resolves.toEqual({
      repositoryId: "r1",
      alias: "llame",
      isPrimary: true,
      isolation: "always_worktree",
    });
  });
});

describe("updateProjectRepositoryLink", () => {
  it("PATCHes only the fields it was given", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: "l1" }));
    await updateProjectRepositoryLink({
      projectId: "p1",
      repositoryId: "r1",
      isolation: "never",
    });

    const request = requestFromCall(fetchMock);
    expect(request.method).toBe("PATCH");
    expect(new URL(request.url).pathname).toBe(
      "/api/v1/projects/p1/repositories/r1",
    );
    await expect(request.clone().json()).resolves.toEqual({
      isolation: "never",
    });
  });
});

describe("unlinkProjectRepository", () => {
  it("DELETEs the project's link", async () => {
    fetchMock.mockResolvedValue(emptyResponse());
    await unlinkProjectRepository("p1", "r1");

    const request = requestFromCall(fetchMock);
    expect(request.method).toBe("DELETE");
    expect(new URL(request.url).pathname).toBe(
      "/api/v1/projects/p1/repositories/r1",
    );
  });
});
