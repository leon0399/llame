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
 * Owner-scoped live update messages from the API's WebSocket. The schemas and
 * types are generated from `apps/api/asyncapi.yaml`; this module adds only
 * frame parsing and connection helpers.
 */

export type { LiveMessage, RunProgressMessage, RunUpdatedMessage };

export type RunPhase = RunProgressMessage["phase"];

/** The run messages the active-runs provider consumes. */
export type RunMessage = RunProgressMessage | RunUpdatedMessage;

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

/** Reconnect delay: exponential from 1 s to 30 s, with full jitter. */
export function reconnectDelayMs(
  attempt: number,
  random: () => number = Math.random,
): number {
  const ceiling = Math.min(30_000, 1000 * 2 ** attempt);
  return Math.round(ceiling / 2 + (random() * ceiling) / 2);
}
