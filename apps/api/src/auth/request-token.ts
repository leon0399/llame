/**
 * Session token extraction shared by the HTTP session guard and the live
 * WebSocket upgrade: a bearer `Authorization` header wins over the session
 * cookie.
 */

import type { IncomingMessage } from 'node:http';

import { SESSION_COOKIE_NAME } from './constants';

/** Session token from a bearer header or the session cookie. */
export function getRequestToken(
  request: Pick<IncomingMessage, 'headers'>,
): string | undefined {
  // Node's IncomingHttpHeaders types (and documents) `authorization`/`cookie`
  // as always a single string on this platform-express app — duplicates of
  // these specific headers are discarded by Node's own parser, never
  // combined into an array — so no defensive array handling is needed here.
  const bearerToken = extractBearerToken(request.headers.authorization);
  if (bearerToken) {
    return bearerToken;
  }

  const cookieHeader = request.headers.cookie;
  return cookieHeader
    ? parseCookie(cookieHeader)[SESSION_COOKIE_NAME]
    : undefined;
}

function extractBearerToken(header: string | undefined): string | undefined {
  // RFC 6750 §2.1: the auth-scheme is case-insensitive; also tolerate repeated
  // whitespace between scheme and token ("Bearer   <token>").
  return header?.match(/^bearer\s+(\S+)\s*$/i)?.[1];
}

function parseCookie(header: string): Record<string, string> {
  return header.split(';').reduce<Record<string, string>>((cookies, part) => {
    const [rawName, ...rawValue] = part.trim().split('=');
    if (!rawName || rawValue.length === 0) {
      return cookies;
    }

    try {
      cookies[rawName] = decodeURIComponent(rawValue.join('='));
    } catch {
      return cookies;
    }

    return cookies;
  }, {});
}
