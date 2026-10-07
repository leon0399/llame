import type { ChatIdentity } from './model-client';

/**
 * A provider entry's effective header map after startup resolution
 * (provider-request-headers D2/D5), type defaults merged under the operator
 * map. Each value is the list of resolved literal parts between the authored
 * `{session:id}` tokens, so `{ 'X-Session-Id': ['', ''] }` is the default and
 * interpolated text is never rescanned for the variable.
 */
export type RequestHeaderTemplates = Readonly<
  Record<string, ReadonlyArray<string>>
>;

/** Header name to value, as sent on one request. */
export type RequestHeaders = Record<string, string>;

/**
 * The Chat identity as a session value (opencode-go-provider D4/D5): the Chat's
 * own id on the conversation's lane, under a `title:` prefix for title
 * generation. A prefix, not a suffix, because the Go gateway picks its first
 * upstream from a hash of the value's last four characters.
 */
export function renderSessionId(chat: ChatIdentity): string {
  return chat.lane === 'title' ? `title:${chat.id}` : chat.id;
}

/**
 * Renders the templates for one request by joining each value's parts with
 * the session id. A value that renders empty is omitted, so `{env:NAME:-}`
 * with `NAME` unset sends nothing (D5).
 */
export function renderRequestHeaders(
  templates: RequestHeaderTemplates,
  chat: ChatIdentity,
): RequestHeaders {
  const sessionId = renderSessionId(chat);
  return Object.fromEntries(
    Object.entries(templates)
      .map(([name, parts]) => [name, parts.join(sessionId)] as const)
      .filter(([, value]) => value.length > 0),
  );
}

/**
 * Lays `overlay` over `base`, matching names case-insensitively, so exactly
 * one value per header name is sent and the overlay's wins (D6/D7).
 */
export function overlayHeaders(
  base: Readonly<RequestHeaders>,
  overlay: Readonly<RequestHeaders>,
): RequestHeaders {
  const overridden = new Set(
    Object.keys(overlay).map((name) => name.toLowerCase()),
  );
  return Object.fromEntries([
    ...Object.entries(base).filter(
      ([name]) => !overridden.has(name.toLowerCase()),
    ),
    ...Object.entries(overlay),
  ]);
}
