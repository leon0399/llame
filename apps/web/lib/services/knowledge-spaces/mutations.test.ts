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
  createKnowledgeSpace,
  renameKnowledgeSpace,
  setKnowledgeSpaceArchive,
} from "./mutations";
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

const SPACE_ID = "6f5d8a0f-7dd3-4f6b-b6ed-9e0f0b1c2d3e";

describe("createKnowledgeSpace", () => {
  it("POSTs /knowledge-spaces with the name only", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: SPACE_ID }));
    await createKnowledgeSpace("Notes");

    const request = requestFromCall(fetchMock);
    expect(request.method).toBe("POST");
    expect(new URL(request.url).pathname).toBe("/api/v1/knowledge-spaces");
    await expect(request.clone().json()).resolves.toEqual({ name: "Notes" });
  });
});

describe("renameKnowledgeSpace", () => {
  it("PATCHes /knowledge-spaces/:id with the name", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: SPACE_ID }));
    await renameKnowledgeSpace(SPACE_ID, "Renamed");

    const request = requestFromCall(fetchMock);
    expect(request.method).toBe("PATCH");
    expect(new URL(request.url).pathname).toBe(
      `/api/v1/knowledge-spaces/${SPACE_ID}`,
    );
    await expect(request.clone().json()).resolves.toEqual({ name: "Renamed" });
  });
});

describe("setKnowledgeSpaceArchive", () => {
  it("PATCHes /knowledge-spaces/:id with the archive state", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: SPACE_ID }));
    await setKnowledgeSpaceArchive(SPACE_ID, true);

    const request = requestFromCall(fetchMock);
    expect(request.method).toBe("PATCH");
    expect(new URL(request.url).pathname).toBe(
      `/api/v1/knowledge-spaces/${SPACE_ID}`,
    );
    await expect(request.clone().json()).resolves.toEqual({ archived: true });
  });
});
