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
 * own id on the main lane, or a lane prefix for title and hosted-search
 * generation. A prefix, not a suffix, because the Go gateway picks its first
 * upstream from a hash of the value's last four characters.
 */
export function renderSessionId(chat: ChatIdentity): string {
  switch (chat.lane) {
    case 'main':
      return chat.id;
    case 'title':
      return `title:${chat.id}`;
    case 'search':
      return `search:${chat.id}`;
    default: {
      const unsupported: never = chat.lane;
      throw new Error(`Unhandled Chat lane: ${String(unsupported)}`);
    }
  }
}

/**
 * Renders the templates for one request and overlays them on the base headers,
 * matching names case-insensitively so the operator's rendered value wins.
 * Joining each value's parts with the session id keeps interpolation startup-
 * resolved and omits values that render empty (D5/D6).
 */
export function withRequestHeaders(
  base: Readonly<RequestHeaders>,
  templates: RequestHeaderTemplates,
  chat: ChatIdentity,
): RequestHeaders {
  const sessionId = renderSessionId(chat);
  const rendered = Object.fromEntries(
    Object.entries(templates)
      .map(([name, parts]) => [name, parts.join(sessionId)] as const)
      .filter(([, value]) => value.length > 0),
  );
  const overridden = new Set(
    Object.keys(rendered).map((name) => name.toLowerCase()),
  );
  return Object.fromEntries([
    ...Object.entries(base).filter(
      ([name]) => !overridden.has(name.toLowerCase()),
    ),
    ...Object.entries(rendered),
  ]);
}
