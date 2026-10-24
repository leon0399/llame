import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";

import { checkoutQueryKeys, fetchCheckouts } from "./queries";
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

describe("checkoutQueryKeys", () => {
  it("uses resource-path query keys", () => {
    expect(checkoutQueryKeys.all).toEqual(["checkouts"]);
    expect(checkoutQueryKeys.lists()).toEqual(["checkouts", "list"]);
    expect(checkoutQueryKeys.list()).toEqual(["checkouts", "list"]);
    expect(checkoutQueryKeys.list({ repositoryId: "r1" })).toEqual([
      "checkouts",
      "list",
      { repositoryId: "r1" },
    ]);
  });
});

describe("fetchCheckouts", () => {
  it("lists the caller's checkouts through the authenticated endpoint", async () => {
    fetchMock.mockResolvedValue(jsonResponse([]));
    await fetchCheckouts();

    const request = requestFromCall(fetchMock);
    expect(request.method).toBe("GET");
    expect(new URL(request.url).pathname).toBe("/api/v1/checkouts");
    expect(new URL(request.url).search).toBe("");
    expect(request.credentials).toBe("include");
  });

  it("passes the repository filter to the server", async () => {
    fetchMock.mockResolvedValue(jsonResponse([]));
    await fetchCheckouts({ repositoryId: "r1" });

    const params = new URL(requestFromCall(fetchMock).url).searchParams;
    expect(params.get("repositoryId")).toBe("r1");
  });
});
