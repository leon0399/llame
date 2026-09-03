import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";

import { forkChat } from "./fork";
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

describe("forkChat", () => {
  it("POSTs the forks sub-collection with the fork-point message id", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: "forked-chat" }));

    const result = await forkChat("chat-1", "msg-1");

    const request = requestFromCall(fetchMock);
    expect(request.method).toBe("POST");
    expect(new URL(request.url).pathname).toBe("/api/v1/chats/chat-1/forks");
    await expect(request.clone().json()).resolves.toEqual({
      fromMessageId: "msg-1",
    });
    expect(result).toEqual({ id: "forked-chat" });
  });

  it("POSTs with no fromMessageId when omitted — forks the whole chat (clone)", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: "cloned-chat" }));

    const result = await forkChat("chat-1");

    const request = requestFromCall(fetchMock);
    const body = await request.clone().text();
    // JSON.stringify drops the undefined property — assert the wire shape,
    // not just the JS object identity.
    expect(body).toBe("{}");
    expect(result).toEqual({ id: "cloned-chat" });
  });
});
