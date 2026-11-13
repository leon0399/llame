/** A JSON-serializable value — the shape of a stubbed fetch response body. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | Array<JsonValue>
  | { [key: string]: JsonValue };

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
