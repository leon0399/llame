import { z } from "zod";

import { getApiUrl } from "../../api/fetch";
import { RunResponseStatus } from "../../api/generated/models";

/**
 * Owner-scoped live update messages from `GET /api/v1/live` (WebSocket).
 * Mirrors `apps/api/src/live/live-messages.ts`. Messages are invalidation
 * hints and run progress summaries; record content is always refetched over
 * HTTP.
 */

const change = z.enum(["created", "updated", "deleted"]);

export const runPhaseSchema = z.enum([
  "queued",
  "thinking",
  "tool",
  "writing",
  "finished",
]);

export type RunPhase = z.infer<typeof runPhaseSchema>;

const liveMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("chat.changed"),
    chatId: z.string(),
    change,
  }),
  z.object({
    type: z.literal("project.changed"),
    projectId: z.string(),
    change,
  }),
  z.object({ type: z.literal("pin.changed"), itemId: z.string() }),
  z.object({
    type: z.literal("run.progress"),
    runId: z.string(),
    chatId: z.string(),
    status: z.enum(RunResponseStatus),
    phase: runPhaseSchema,
    step: z.number().int().nonnegative(),
  }),
  z.object({ type: z.literal("resync") }),
]);

export type LiveMessage = z.infer<typeof liveMessageSchema>;
export type RunProgressMessage = Extract<LiveMessage, { type: "run.progress" }>;

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
  const url = new URL("/api/v1/live", apiUrl);
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
