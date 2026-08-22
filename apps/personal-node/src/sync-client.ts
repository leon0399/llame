import { parseChangeBatch } from "@workspace/federation-experiment";
import { z } from "zod";

import type { SqlitePersonalRealmStore } from "./sqlite-replica.js";

const MAX_SYNC_RESPONSE_BYTES = 8 * 1024 * 1024;
const frontierSchema = z.record(
  z.string().min(1),
  z.number().int().nonnegative(),
);
const exportResponseSchema = z.strictObject({
  batches: z.array(z.unknown()),
  sourceFrontier: frontierSchema,
});
const applyResponseSchema = z.strictObject({
  applied: z.number().int().nonnegative(),
  frontier: frontierSchema,
});

export interface SyncFromPeerOptions {
  readonly store: SqlitePersonalRealmStore;
  readonly peerUrl: string;
  readonly bearerToken: string;
}

export interface PeerSyncResult {
  readonly pulled: number;
  readonly pushed: number;
  readonly localFrontier: Readonly<Record<string, number>>;
  readonly peerFrontier: Readonly<Record<string, number>>;
  readonly coverage: "verified-complete" | "partial";
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (
    !Number.isFinite(declaredLength) ||
    declaredLength > MAX_SYNC_RESPONSE_BYTES
  ) {
    throw new Error("peer sync response is too large");
  }
  if (response.body === null) throw new Error("peer sync response has no body");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let receivedBytes = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    receivedBytes += result.value.byteLength;
    if (receivedBytes > MAX_SYNC_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error("peer sync response is too large");
    }
    chunks.push(result.value);
  }
  const payload = Buffer.concat(chunks).toString("utf8");
  try {
    const input: unknown = JSON.parse(payload);
    return input;
  } catch {
    throw new Error("peer sync response is not valid JSON");
  }
}

export async function syncFromPeer(
  options: SyncFromPeerOptions,
): Promise<PeerSyncResult> {
  if (options.bearerToken.length < 16) {
    throw new Error("peer bearer token must contain at least 16 characters");
  }
  const peerUrl = new URL(options.peerUrl);
  if (
    (peerUrl.protocol !== "http:" && peerUrl.protocol !== "https:") ||
    peerUrl.username.length > 0 ||
    peerUrl.password.length > 0 ||
    (peerUrl.pathname !== "/" && peerUrl.pathname !== "")
  ) {
    throw new Error(
      "peer URL must be an HTTP origin without credentials or path",
    );
  }
  if (
    peerUrl.protocol === "http:" &&
    peerUrl.hostname !== "127.0.0.1" &&
    peerUrl.hostname !== "localhost" &&
    peerUrl.hostname !== "[::1]"
  ) {
    throw new Error("plaintext peer URL must use a loopback host");
  }
  const exportResponse = await fetch(new URL("/v1/sync/export", peerUrl), {
    method: "POST",
    headers: {
      authorization: `Bearer ${options.bearerToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ frontier: options.store.frontier() }),
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  if (!exportResponse.ok) {
    throw new Error(
      `peer sync export failed with HTTP ${exportResponse.status}`,
    );
  }
  const exported = exportResponseSchema.safeParse(
    await readBoundedJson(exportResponse),
  );
  if (!exported.success) {
    throw new Error("peer sync export response has invalid shape");
  }

  let pulled = 0;
  for (const input of exported.data.batches) {
    const result = options.store.receive(parseChangeBatch(input));
    if (result.status === "applied") pulled += 1;
  }
  const localFrontier = options.store.frontier();
  const batchesToPush = options.store.exportMissing(
    exported.data.sourceFrontier,
  );
  const applyResponse = await fetch(new URL("/v1/sync/apply", peerUrl), {
    method: "POST",
    headers: {
      authorization: `Bearer ${options.bearerToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      batches: batchesToPush,
      sourceFrontier: localFrontier,
    }),
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  if (!applyResponse.ok) {
    throw new Error(`peer sync apply failed with HTTP ${applyResponse.status}`);
  }
  const applied = applyResponseSchema.safeParse(
    await readBoundedJson(applyResponse),
  );
  if (!applied.success) {
    throw new Error("peer sync apply response has invalid shape");
  }
  const localCoverage = options.store.coverageAgainst(applied.data.frontier);
  const peerComplete = Object.entries(localFrontier).every(
    ([writerStreamId, sequence]) =>
      (applied.data.frontier[writerStreamId] ?? 0) >= sequence,
  );
  return {
    pulled,
    pushed: applied.data.applied,
    localFrontier: localCoverage.frontier,
    peerFrontier: applied.data.frontier,
    coverage:
      localCoverage.status === "verified-complete" && peerComplete
        ? "verified-complete"
        : "partial",
  };
}
