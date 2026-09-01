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
  deleteChat,
  renameChat,
  setChatArchive,
  setChatVisibility,
} from "./management";
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

describe("renameChat", () => {
  it("PATCHes /chats/:id with the new title", async () => {
    fetchMock.mockResolvedValue(emptyResponse());
    await renameChat("c1", "New title");

    const request = requestFromCall(fetchMock);
    expect(request.method).toBe("PATCH");
    expect(new URL(request.url).pathname).toBe("/api/v1/chats/c1");
    await expect(request.clone().json()).resolves.toEqual({
      title: "New title",
    });
  });
});

describe("setChatVisibility", () => {
  it("PATCHes /chats/:id with the visibility", async () => {
    fetchMock.mockResolvedValue(emptyResponse());
    await setChatVisibility("c1", "public");

    const request = requestFromCall(fetchMock);
    expect(request.method).toBe("PATCH");
    expect(new URL(request.url).pathname).toBe("/api/v1/chats/c1");
    await expect(request.clone().json()).resolves.toEqual({
      visibility: "public",
    });
  });
});

describe("setChatArchive", () => {
  it("PATCHes /chats/:id with the archived flag", async () => {
    fetchMock.mockResolvedValue(emptyResponse());
    await setChatArchive("c1", true);

    const request = requestFromCall(fetchMock);
    expect(request.method).toBe("PATCH");
    expect(new URL(request.url).pathname).toBe("/api/v1/chats/c1");
    await expect(request.clone().json()).resolves.toEqual({ archived: true });
  });
});

describe("deleteChat", () => {
  it("DELETEs /chats/:id", async () => {
    fetchMock.mockResolvedValue(emptyResponse());
    await deleteChat("c1");

    const request = requestFromCall(fetchMock);
    expect(request.method).toBe("DELETE");
    expect(new URL(request.url).pathname).toBe("/api/v1/chats/c1");
  });

  it("swallows a 404 (already deleted) as success", async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, 404));
    await expect(deleteChat("gone")).resolves.toBeUndefined();
  });

  it("rethrows non-404 errors", async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, 500));
    await expect(deleteChat("c1")).rejects.toMatchObject({ status: 500 });
  });
});
