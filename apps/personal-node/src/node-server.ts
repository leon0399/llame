import { createHash, timingSafeEqual } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";

import {
  parseChangeBatch,
  WRITER_STREAM_ID_PATTERN,
} from "@workspace/federation-experiment";
import { z } from "zod";

import type { SqlitePersonalRealmStore } from "./sqlite-replica.js";
import type { SqliteEnrollmentRegistry } from "./enrollment-registry.js";

const MAX_BODY_BYTES = 1024 * 1024;

const frontierSchema = z.record(
  z.string().min(1),
  z.number().int().nonnegative(),
);
const exportRequestSchema = z.strictObject({ frontier: frontierSchema });
const applyRequestSchema = z.strictObject({
  batches: z.array(z.unknown()),
  sourceFrontier: frontierSchema,
});
const enrollmentChallengeRequestSchema = z.strictObject({
  nodeId: z.string().regex(WRITER_STREAM_ID_PATTERN),
});
const completeEnrollmentRequestSchema = z.strictObject({ proof: z.unknown() });

export interface PersonalNodeServerOptions {
  readonly nodeId: string;
  readonly bearerToken: string;
  readonly store: SqlitePersonalRealmStore;
  readonly enrollmentRegistry?: SqliteEnrollmentRegistry;
}

class RequestError extends Error {
  public constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

function sendJson(
  response: ServerResponse,
  status: number,
  body: unknown,
  headers: Readonly<Record<string, string>> = {},
): void {
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-type": "application/json",
    ...headers,
  });
  response.end(JSON.stringify(body));
}

function bearerCredential(request: IncomingMessage): string | null {
  const authorization = request.headers.authorization;
  if (authorization?.startsWith("Bearer ") !== true) {
    return null;
  }
  const credential = authorization.slice("Bearer ".length);
  return credential.length === 0 ? null : credential;
}

function credentialMatches(
  suppliedCredential: string,
  expectedDigest: Buffer,
): boolean {
  const suppliedDigest = createHash("sha256")
    .update(suppliedCredential)
    .digest();
  return timingSafeEqual(expectedDigest, suppliedDigest);
}

function isEnrollmentControlRequest(request: IncomingMessage): boolean {
  const url = new URL(request.url ?? "/", "http://personal-node.local");
  return (
    (request.method === "POST" &&
      (url.pathname === "/v1/enrollment/challenges" ||
        url.pathname === "/v1/enrollment/complete")) ||
    (request.method === "DELETE" &&
      /^\/v1\/enrollments\/[^/]+$/.test(url.pathname))
  );
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  if (!request.headers["content-type"]?.startsWith("application/json")) {
    throw new RequestError(415, "json_content_type_required");
  }
  const declaredLength = Number(request.headers["content-length"] ?? 0);
  if (!Number.isFinite(declaredLength) || declaredLength > MAX_BODY_BYTES) {
    throw new RequestError(413, "request_body_too_large");
  }
  const chunks: Buffer[] = [];
  let receivedBytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    receivedBytes += buffer.byteLength;
    if (receivedBytes > MAX_BODY_BYTES) {
      request.resume();
      throw new RequestError(413, "request_body_too_large");
    }
    chunks.push(buffer);
  }
  try {
    const input: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    return input;
  } catch {
    throw new RequestError(400, "invalid_json");
  }
}

async function handleAuthorizedRequest(
  request: IncomingMessage,
  response: ServerResponse,
  options: PersonalNodeServerOptions,
): Promise<void> {
  const url = new URL(request.url ?? "/", "http://personal-node.local");
  if (request.method === "GET" && url.pathname === "/v1/capabilities") {
    sendJson(response, 200, {
      protocol: { name: "llame-node", version: 1 },
      node: { id: options.nodeId, profile: "single-owner-personal" },
      realm: { id: options.store.realmId() },
      modules: {
        "sync.personal-realm": { version: 1, mode: "read-write" },
        "sync.signed-personal-realm": options.store.signedSyncAvailable()
          ? { version: 1, mode: "read-write" }
          : { available: false },
        "enrollment.node":
          options.enrollmentRegistry === undefined
            ? { available: false }
            : { version: 1, mode: "read-write" },
        "execution.workspace": { available: false },
      },
    });
    return;
  }
  if (
    request.method === "POST" &&
    url.pathname === "/v1/enrollment/challenges"
  ) {
    if (options.enrollmentRegistry === undefined) {
      throw new RequestError(409, "enrollment_unavailable");
    }
    const parsed = enrollmentChallengeRequestSchema.safeParse(
      await readJson(request),
    );
    if (!parsed.success) {
      throw new RequestError(400, "invalid_enrollment_challenge_request");
    }
    sendJson(
      response,
      201,
      options.enrollmentRegistry.issueChallenge({ nodeId: parsed.data.nodeId }),
    );
    return;
  }
  if (request.method === "POST" && url.pathname === "/v1/enrollment/complete") {
    if (options.enrollmentRegistry === undefined) {
      throw new RequestError(409, "enrollment_unavailable");
    }
    const parsed = completeEnrollmentRequestSchema.safeParse(
      await readJson(request),
    );
    if (!parsed.success) {
      throw new RequestError(400, "invalid_enrollment_request");
    }
    sendJson(
      response,
      201,
      options.enrollmentRegistry.completeEnrollment(parsed.data.proof),
    );
    return;
  }
  const enrollmentMatch = /^\/v1\/enrollments\/([^/]+)$/.exec(url.pathname);
  if (request.method === "DELETE" && enrollmentMatch !== null) {
    if (options.enrollmentRegistry === undefined) {
      throw new RequestError(409, "enrollment_unavailable");
    }
    const encodedNodeId = enrollmentMatch[1];
    if (encodedNodeId === undefined) {
      throw new RequestError(400, "invalid_node_id");
    }
    let nodeId: string;
    try {
      nodeId = decodeURIComponent(encodedNodeId);
    } catch {
      throw new RequestError(400, "invalid_node_id");
    }
    if (!WRITER_STREAM_ID_PATTERN.test(nodeId)) {
      throw new RequestError(400, "invalid_node_id");
    }
    sendJson(response, 200, {
      revoked: options.enrollmentRegistry.revoke(nodeId),
    });
    return;
  }
  if (request.method === "GET" && url.pathname === "/v1/realm/frontier") {
    sendJson(response, 200, { frontier: options.store.frontier() });
    return;
  }
  if (request.method === "POST" && url.pathname === "/v1/sync/export") {
    const parsed = exportRequestSchema.safeParse(await readJson(request));
    if (!parsed.success) {
      throw new RequestError(400, "invalid_export_request");
    }
    sendJson(response, 200, {
      batches: options.store.exportMissing(parsed.data.frontier),
      sourceFrontier: options.store.frontier(),
    });
    return;
  }
  if (request.method === "POST" && url.pathname === "/v1/signed-sync/export") {
    if (!options.store.signedSyncAvailable()) {
      throw new RequestError(409, "signed_sync_unavailable");
    }
    const parsed = exportRequestSchema.safeParse(await readJson(request));
    if (!parsed.success) {
      throw new RequestError(400, "invalid_export_request");
    }
    sendJson(response, 200, {
      batches: options.store.exportSignedMissing(parsed.data.frontier),
      sourceFrontier: options.store.frontier(),
    });
    return;
  }
  if (request.method === "POST" && url.pathname === "/v1/sync/apply") {
    const parsed = applyRequestSchema.safeParse(await readJson(request));
    if (!parsed.success) {
      throw new RequestError(400, "invalid_apply_request");
    }
    let applied = 0;
    for (const input of parsed.data.batches) {
      const result = options.store.receive(parseChangeBatch(input));
      if (result.status === "applied") applied += 1;
    }
    sendJson(response, 200, { applied, frontier: options.store.frontier() });
    return;
  }
  if (request.method === "POST" && url.pathname === "/v1/signed-sync/apply") {
    if (!options.store.signedSyncAvailable()) {
      throw new RequestError(409, "signed_sync_unavailable");
    }
    const parsed = applyRequestSchema.safeParse(await readJson(request));
    if (!parsed.success) {
      throw new RequestError(400, "invalid_apply_request");
    }
    let applied = 0;
    for (const input of parsed.data.batches) {
      const result = options.store.receiveSigned(input);
      if (result.status === "applied") applied += 1;
    }
    sendJson(response, 200, { applied, frontier: options.store.frontier() });
    return;
  }
  const branchMatch = /^\/v1\/chats\/([^/]+)\/branches$/.exec(url.pathname);
  if (request.method === "GET" && branchMatch !== null) {
    const encodedChatId = branchMatch[1];
    if (encodedChatId === undefined) {
      throw new RequestError(400, "invalid_chat_id");
    }
    let chatId: string;
    try {
      chatId = decodeURIComponent(encodedChatId);
    } catch {
      throw new RequestError(400, "invalid_chat_id");
    }
    if (chatId.length === 0 || chatId.includes("/")) {
      throw new RequestError(400, "invalid_chat_id");
    }
    sendJson(response, 200, { branches: options.store.chatBranches(chatId) });
    return;
  }
  throw new RequestError(404, "not_found");
}

export function createPersonalNodeServer(
  options: PersonalNodeServerOptions,
): Server {
  if (options.nodeId.length === 0) throw new Error("nodeId is required");
  if (options.bearerToken.length < 16) {
    throw new Error("bearerToken must contain at least 16 characters");
  }
  const expectedTokenDigest = createHash("sha256")
    .update(options.bearerToken)
    .digest();
  return createServer((request, response) => {
    const suppliedCredential = bearerCredential(request);
    const ownerAuthenticated =
      suppliedCredential !== null &&
      credentialMatches(suppliedCredential, expectedTokenDigest);
    const nodeAuthenticated =
      suppliedCredential !== null &&
      options.enrollmentRegistry?.authenticate(suppliedCredential) !== null;
    if (
      !ownerAuthenticated &&
      (isEnrollmentControlRequest(request) || !nodeAuthenticated)
    ) {
      sendJson(
        response,
        401,
        { error: "unauthorized" },
        {
          "www-authenticate": "Bearer",
        },
      );
      return;
    }
    void handleAuthorizedRequest(request, response, options).catch((error) => {
      if (error instanceof RequestError) {
        sendJson(response, error.status, { error: error.code });
        return;
      }
      sendJson(response, 409, { error: "operation_rejected" });
    });
  });
}
