import { vi, type Mock } from "vitest";

export { emptyResponse, jsonResponse } from "./fetch-responses";

export type { JsonValue } from "./fetch-responses";

/**
 * Stub `globalThis.fetch` with a real Fetch-API mock for the duration of a
 * test. This is the documented DI seam (lib/api/CLAUDE.md: "the caller
 * supplies the final `fetch` argument") — every generated endpoint and the
 * authenticated-fetch policy run for real against it, so tests exercise real
 * URL construction, JSON parsing, and error mapping instead of an echoed
 * module mock. Call from `beforeEach`; pair with `vi.unstubAllGlobals()` in
 * `afterEach`.
 */
export function stubFetch(): Mock<typeof fetch> {
  const fetchMock = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", fetchMock);

  return fetchMock;
}

/** The `Request` a stubbed fetch call received; throws if it received none. */
export function requestFromCall(
  fetchMock: Mock<typeof fetch>,
  index = 0,
): Request {
  const request = fetchMock.mock.calls[index]?.[0];

  if (!(request instanceof Request)) {
    throw new Error(`expected fetch call ${index} to receive a Request`);
  }

  return request;
}
