import { z } from "zod";

import { getApiUrl } from "../../api/fetch";
import {
  LIVE_CHANNEL_ADDRESS,
  liveMessageSchema,
  type LiveMessage,
  type RunProgressMessage,
  type RunUpdatedMessage,
} from "../../api/live-generated/live-protocol";

/**
 * Live update messages from the API's WebSocket: owner-scoped records plus the
 * instance-wide Machine record. The schemas and types are generated from
 * `apps/api/asyncapi.websocket.yaml`; this module adds only frame parsing and
 * connection helpers.
 */

export type { LiveMessage, RunProgressMessage, RunUpdatedMessage };

export type RunPhase = RunProgressMessage["phase"];

/** The run messages the active-runs provider consumes. */
export type RunMessage = RunProgressMessage | RunUpdatedMessage;

/** Close code for a session that ended; the client signs in again rather than reconnecting. */
export const CLOSE_SESSION_ENDED = 4401;

/** Parse one frame; `undefined` for a binary frame, malformed JSON, or an
 *  unknown message type (forward compatible: a newer server may send types
 *  this client ignores). */
export function parseLiveMessage(data: unknown): LiveMessage | undefined {
  const text = z.string().safeParse(data);
  if (!text.success) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.data);
  } catch {
    return undefined;
  }
  const result = liveMessageSchema.safeParse(parsed);
  return result.success ? result.data : undefined;
}

/** `ws(s)://` URL of the live endpoint on the configured API origin. */
export function liveUpdatesUrl(apiUrl: string = getApiUrl()): string {
  const url = new URL(LIVE_CHANNEL_ADDRESS, apiUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}
