import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";

import { registerCheckout, removeCheckoutWorktree } from "./mutations";
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

describe("registerCheckout", () => {
  it("POSTs one path and the selectors it was given", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: "c1" }, 201));
    await registerCheckout({
      path: "machine://nas/home/leo/src/llame",
      repositoryId: "r1",
      remote: "git@github.com:leon0399/llame.git",
    });

    const request = requestFromCall(fetchMock);
    expect(request.method).toBe("POST");
    expect(new URL(request.url).pathname).toBe("/api/v1/checkouts");
    await expect(request.clone().json()).resolves.toEqual({
      path: "machine://nas/home/leo/src/llame",
      repositoryId: "r1",
      remote: "git@github.com:leon0399/llame.git",
    });
  });

  it("omits a selector the caller did not choose", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: "c1" }, 201));
    await registerCheckout({ path: "/home/leo/src/llame" });

    // No selector key at all, rather than a key holding undefined.
    await expect(requestFromCall(fetchMock).clone().json()).resolves.toEqual({
      path: "/home/leo/src/llame",
    });
  });
});

describe("removeCheckoutWorktree", () => {
  it("DELETEs the guarded worktree route", async () => {
    fetchMock.mockResolvedValue(emptyResponse());
    await removeCheckoutWorktree("c2");

    const request = requestFromCall(fetchMock);
    expect(request.method).toBe("DELETE");
    expect(new URL(request.url).pathname).toBe("/api/v1/checkouts/c2/worktree");
  });
});
