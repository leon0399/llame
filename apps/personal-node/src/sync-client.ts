import { parseChangeBatch } from "@workspace/federation-experiment";
import { z } from "zod";

import type { SqlitePersonalRealmStore } from "./sqlite-replica.js";

const MAX_SYNC_RESPONSE_BYTES = 8 * 1024 * 1024;
const MAX_SYNC_ROUNDS = 3;
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
  readonly mode?: "unsigned" | "signed";
}

export interface PeerSyncResult {
  readonly rounds: number;
  readonly outcomeUnknownRecoveries: number;
  readonly pulled: number;
  readonly pushed: number;
  readonly localFrontier: Readonly<Record<string, number>>;
  readonly peerFrontier: Readonly<Record<string, number>>;
  readonly coverage: "verified-complete" | "partial";
}

type PeerSyncRoundResult = Omit<
  PeerSyncResult,
  "rounds" | "outcomeUnknownRecoveries"
>;

class ApplyOutcomeUnknownError extends Error {
  public constructor(
    readonly pulled: number,
    cause: unknown,
  ) {
    super("peer apply outcome is unknown", { cause });
  }
}

export class PeerSyncOutcomeUnknownError extends Error {
  public constructor(
    readonly rounds: number,
    readonly localFrontier: Readonly<Record<string, number>>,
    cause: unknown,
  ) {
    super("peer apply outcome remained unknown after bounded recovery", {
      cause,
    });
    this.name = "PeerSyncOutcomeUnknownError";
  }
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

async function reconcileOnce(
  options: SyncFromPeerOptions,
): Promise<PeerSyncRoundResult> {
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
  const syncPath = options.mode === "signed" ? "/v1/signed-sync" : "/v1/sync";
  const exportResponse = await fetch(new URL(`${syncPath}/export`, peerUrl), {
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
    const result =
      options.mode === "signed"
        ? options.store.receiveSigned(input)
        : options.store.receive(parseChangeBatch(input));
    if (result.status === "applied") pulled += 1;
  }
  const localFrontier = options.store.frontier();
  const batchesToPush =
    options.mode === "signed"
      ? options.store.exportSignedMissing(exported.data.sourceFrontier)
      : options.store.exportMissing(exported.data.sourceFrontier);
  let applied: z.infer<typeof applyResponseSchema>;
  try {
    const applyResponse = await fetch(new URL(`${syncPath}/apply`, peerUrl), {
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
      throw new Error(
        `peer sync apply failed with HTTP ${applyResponse.status}`,
      );
    }
    const result = applyResponseSchema.safeParse(
      await readBoundedJson(applyResponse),
    );
    if (!result.success) {
      throw new Error("peer sync apply response has invalid shape");
    }
    applied = result.data;
  } catch (error) {
    throw new ApplyOutcomeUnknownError(pulled, error);
  }
  const localCoverage = options.store.coverageAgainst(applied.frontier);
  const peerComplete = Object.entries(localFrontier).every(
    ([writerStreamId, sequence]) =>
      (applied.frontier[writerStreamId] ?? 0) >= sequence,
  );
  return {
    pulled,
    pushed: applied.applied,
    localFrontier: localCoverage.frontier,
    peerFrontier: applied.frontier,
    coverage:
      localCoverage.status === "verified-complete" && peerComplete
        ? "verified-complete"
        : "partial",
  };
}

export async function syncFromPeer(
  options: SyncFromPeerOptions,
): Promise<PeerSyncResult> {
  let pulled = 0;
  let pushed = 0;
  let latest: PeerSyncRoundResult | undefined;
  let outcomeUnknownRecoveries = 0;
  for (let round = 1; round <= MAX_SYNC_ROUNDS; round += 1) {
    try {
      latest = await reconcileOnce(options);
    } catch (error) {
      if (!(error instanceof ApplyOutcomeUnknownError)) throw error;
      pulled += error.pulled;
      outcomeUnknownRecoveries += 1;
      if (round === MAX_SYNC_ROUNDS) {
        throw new PeerSyncOutcomeUnknownError(
          round,
          options.store.frontier(),
          error,
        );
      }
      continue;
    }
    pulled += latest.pulled;
    pushed += latest.pushed;
    if (latest.coverage === "verified-complete") {
      return {
        ...latest,
        rounds: round,
        outcomeUnknownRecoveries,
        pulled,
        pushed,
      };
    }
  }
  if (latest === undefined) throw new Error("personal Realm sync did not run");
  return {
    ...latest,
    rounds: MAX_SYNC_ROUNDS,
    outcomeUnknownRecoveries,
    pulled,
    pushed,
  };
}
