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
  setProjectArchive,
  updateProject,
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
  it("POSTs /projects with the name", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: "p1" }));
    await createProject("Acme");

    const request = requestFromCall(fetchMock);
    expect(request.method).toBe("POST");
    expect(new URL(request.url).pathname).toBe("/api/v1/projects");
    await expect(request.clone().json()).resolves.toEqual({ name: "Acme" });
  });
});

describe("updateProject", () => {
  it("PATCHes /projects/:id with the name", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: "p1" }));
    await updateProject("p1", "Renamed");

    const request = requestFromCall(fetchMock);
    expect(request.method).toBe("PATCH");
    expect(new URL(request.url).pathname).toBe("/api/v1/projects/p1");
    await expect(request.clone().json()).resolves.toEqual({
      name: "Renamed",
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
