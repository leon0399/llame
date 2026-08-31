import { vi, type Mock } from "vitest";

/** A JSON-serializable value — the shape of a stubbed fetch response body. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | Array<JsonValue>
  | { [key: string]: JsonValue };

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

/**
 * Build a real `Response` carrying a JSON body, for a stubbed fetch call.
 * Generic rather than `JsonValue`-typed: a named generated response type
 * (e.g. `PublicUserResponse`) has no index signature, so it fails
 * structural assignment to an index-signature type like `JsonValue` even
 * though every field matches — this keeps the call site's own type intact
 * instead of fighting that TS limitation with a cast.
 */
export function jsonResponse<T extends JsonValue | object>(
  body: T,
  status = 200,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * Build a real, body-less `Response` — the Fetch API rejects a body on a
 * null-body status (204/205/304), which every generated endpoint also
 * special-cases to skip `res.text()` entirely.
 */
export function emptyResponse(status: 204 | 205 | 304 = 204): Response {
  return new Response(null, { status });
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
