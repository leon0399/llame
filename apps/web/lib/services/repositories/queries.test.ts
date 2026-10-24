import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";

import { fetchRepositories, repositoryQueryKeys } from "./queries";
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

describe("repositoryQueryKeys", () => {
  it("uses resource-path query keys", () => {
    expect(repositoryQueryKeys.all).toEqual(["repositories"]);
    expect(repositoryQueryKeys.list()).toEqual(["repositories", "list"]);
  });
});

describe("fetchRepositories", () => {
  it("lists the owner's catalog through the authenticated endpoint", async () => {
    fetchMock.mockResolvedValue(jsonResponse([]));
    await fetchRepositories();

    const request = requestFromCall(fetchMock);
    expect(request.method).toBe("GET");
    expect(new URL(request.url).pathname).toBe("/api/v1/repositories");
    expect(request.credentials).toBe("include");
  });
});
