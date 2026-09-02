import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";

import { fetchSharedChat, forkSharedChat } from "./shared";
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

describe("fetchSharedChat", () => {
  it("GETs the public /shared/chats/:id endpoint with no search params by default", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ id: "c1", title: "x", messages: [] }),
    );
    const result = await fetchSharedChat("c1");

    const request = requestFromCall(fetchMock);
    expect(request.method).toBe("GET");
    const url = new URL(request.url);
    expect(url.pathname).toBe("/api/v1/shared/chats/c1");
    expect(url.search).toBe("");
    expect(result.id).toBe("c1");
  });

  it("forwards limit/beforeSeq as search params for cursor pagination", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ id: "c1", title: "x", messages: [] }),
    );
    await fetchSharedChat("c1", { limit: 100, beforeSeq: 42 });

    const request = requestFromCall(fetchMock);
    const params = new URL(request.url).searchParams;
    expect(params.get("limit")).toBe("100");
    expect(params.get("beforeSeq")).toBe("42");
  });
});

describe("forkSharedChat", () => {
  it("POSTs the shared chat's forks sub-collection", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: "new-chat" }));
    const result = await forkSharedChat("c1");

    const request = requestFromCall(fetchMock);
    expect(request.method).toBe("POST");
    expect(new URL(request.url).pathname).toBe("/api/v1/shared/chats/c1/forks");
    expect(result.id).toBe("new-chat");
  });
});
