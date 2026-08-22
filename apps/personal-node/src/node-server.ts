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
import type { NodeScope } from "@workspace/federation-experiment/node-enrollment";
import { z } from "zod";

import type { SqlitePersonalRealmStore } from "./sqlite-replica.js";
import type { SqliteEnrollmentRegistry } from "./enrollment-registry.js";
import type { SignedRealmRunAuthor } from "./realm-run-author.js";
import type { PeerSyncStatus } from "./peer-sync-supervisor.js";
import type { SqliteRunControlStore } from "./run-control-store.js";
import {
  WorkspaceUnavailableError,
  type WorkspaceRegistry,
} from "./workspace-registry.js";

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
const nodeScopeSchema = z.enum([
  "realm.sync",
  "run.observe",
  "run.steer",
  "run.execute",
  "run.control",
]);
const completeEnrollmentRequestSchema = z.strictObject({
  proof: z.unknown(),
  scopes: z.array(nodeScopeSchema).min(1).max(5),
});
const createRunRequestSchema = z.strictObject({
  runId: z.string().min(1).max(200),
  executorNodeId: z.string().regex(WRITER_STREAM_ID_PATTERN),
});
const runEventRequestSchema = z.strictObject({
  authorityEpoch: z.number().int().positive(),
  sequence: z.number().int().positive(),
  eventId: z.string().min(1).max(200),
  event: z.unknown(),
});
const runCommandRequestSchema = z.strictObject({
  commandId: z.string().min(1).max(200),
  authorityEpoch: z.number().int().positive(),
  command: z.unknown(),
});
const transferRunAuthorityRequestSchema = z.strictObject({
  expectedAuthorityEpoch: z.number().int().positive(),
  targetExecutorNodeId: z.string().regex(WRITER_STREAM_ID_PATTERN),
  reason: z.enum(["handoff", "fallback", "recovery", "workspace-exit"]),
});
const workspaceAffinityRequestSchema = z.strictObject({
  workspaceId: z.string().min(1).max(200),
  policy: z.enum(["ask", "wait", "fallback", "exit"]),
});
const workspaceEntryRequestSchema = z.strictObject({
  workspaceId: z.string().min(1).max(200),
});
const workspaceUnavailableRequestSchema = z.strictObject({
  executorNodeId: z.string().regex(WRITER_STREAM_ID_PATTERN),
  continuationExecutorNodeId: z
    .string()
    .regex(WRITER_STREAM_ID_PATTERN)
    .nullable(),
  egressAllowsFallback: z.boolean(),
});
const workspaceRecoveryChoiceRequestSchema = z.strictObject({
  action: z.enum(["wait", "fallback", "exit"]),
  continuationExecutorNodeId: z
    .string()
    .regex(WRITER_STREAM_ID_PATTERN)
    .nullable(),
  egressAllowsFallback: z.boolean(),
});
const emptyRequestSchema = z.strictObject({});

export interface PersonalNodeServerOptions {
  readonly nodeId: string;
  readonly bearerToken: string;
  readonly store: SqlitePersonalRealmStore;
  readonly enrollmentRegistry?: SqliteEnrollmentRegistry;
  readonly runControlStore?: SqliteRunControlStore;
  readonly journalRunProjection?: boolean;
  readonly journalRunAuthor?: SignedRealmRunAuthor;
  readonly peerSyncStatus?: () => PeerSyncStatus;
  readonly workspaceRegistry?: WorkspaceRegistry;
}

type RequestPrincipal =
  | { readonly kind: "owner"; readonly nodeId: string }
  | {
      readonly kind: "node";
      readonly nodeId: string;
      readonly keyId: string;
      readonly scopes: readonly NodeScope[];
    };

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

function routeRequirement(
  request: IncomingMessage,
): NodeScope | "owner" | null {
  const url = new URL(request.url ?? "/", "http://personal-node.local");
  if (request.method === "GET" && url.pathname === "/v1/capabilities") {
    return null;
  }
  if (
    (request.method === "POST" &&
      (url.pathname === "/v1/enrollment/challenges" ||
        url.pathname === "/v1/enrollment/complete")) ||
    (request.method === "DELETE" &&
      /^\/v1\/enrollments\/[^/]+$/.test(url.pathname))
  ) {
    return "owner";
  }
  if (
    request.method === "POST" &&
    /^\/v1\/workspace-entry-requests\/[^/]+\/approve$/.test(url.pathname)
  ) {
    return "owner";
  }
  if (request.method === "POST" && url.pathname === "/v1/runs") {
    return "run.control";
  }
  if (
    request.method === "POST" &&
    (/^\/v1\/runs\/[^/]+\/authority$/.test(url.pathname) ||
      /^\/v1\/runs\/[^/]+\/workspace(?:\/(?:enter|exit|unavailable|recovered|choice))?$/.test(
        url.pathname,
      ))
  ) {
    return "run.control";
  }
  if (
    request.method === "GET" &&
    (url.pathname === "/v1/workspaces" ||
      /^\/v1\/runs\/[^/]+\/control$/.test(url.pathname) ||
      /^\/v1\/runs\/[^/]+\/workspace$/.test(url.pathname))
  ) {
    return "run.observe";
  }
  if (
    (request.method === "POST" &&
      /^\/v1\/runs\/[^/]+\/events$/.test(url.pathname)) ||
    (request.method === "GET" &&
      (/^\/v1\/runs\/[^/]+\/commands$/.test(url.pathname) ||
        /^\/v1\/runs\/[^/]+\/workspace\/binding$/.test(url.pathname)))
  ) {
    return "run.execute";
  }
  if (
    request.method === "POST" &&
    /^\/v1\/runs\/[^/]+\/commands$/.test(url.pathname)
  ) {
    return "run.steer";
  }
  if (
    url.pathname === "/v1/realm/frontier" ||
    /^\/v1\/(?:signed-)?sync\/(?:export|apply)$/.test(url.pathname) ||
    /^\/v1\/chats\/[^/]+\/branches$/.test(url.pathname)
  ) {
    return "realm.sync";
  }
  return null;
}

function decodePathIdentity(encoded: string | undefined, name: string): string {
  if (encoded === undefined) throw new RequestError(400, `invalid_${name}`);
  let decoded: string;
  try {
    decoded = decodeURIComponent(encoded);
  } catch {
    throw new RequestError(400, `invalid_${name}`);
  }
  if (decoded.length === 0 || decoded.length > 200 || decoded.includes("/")) {
    throw new RequestError(400, `invalid_${name}`);
  }
  return decoded;
}

function cursorFrom(url: URL): number {
  const input = url.searchParams.get("after") ?? "0";
  if (!/^(0|[1-9][0-9]*)$/.test(input)) {
    throw new RequestError(400, "invalid_cursor");
  }
  const cursor = Number(input);
  if (!Number.isSafeInteger(cursor)) {
    throw new RequestError(400, "invalid_cursor");
  }
  return cursor;
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
  principal: RequestPrincipal,
): Promise<void> {
  const url = new URL(request.url ?? "/", "http://personal-node.local");
  const usesJournalRunProjection =
    options.journalRunProjection === true ||
    options.journalRunAuthor !== undefined;
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
        ...(options.peerSyncStatus === undefined
          ? {}
          : {
              "sync.peer": {
                version: 1,
                ...options.peerSyncStatus(),
              },
            }),
        "enrollment.node":
          options.enrollmentRegistry === undefined
            ? { available: false }
            : { version: 1, mode: "read-write" },
        "execution.run-control":
          options.journalRunAuthor !== undefined
            ? { version: 1, mode: "signed-journal" }
            : usesJournalRunProjection
              ? { version: 1, mode: "signed-journal-read-only" }
              : options.runControlStore === undefined
                ? { available: false }
                : { version: 1, mode: "read-write" },
        "execution.workspace":
          options.workspaceRegistry === undefined
            ? { available: false }
            : { version: 1, mode: "policy-gated-binding" },
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
      options.enrollmentRegistry.completeEnrollment(
        parsed.data.proof,
        new Date(),
        parsed.data.scopes,
      ),
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
  if (request.method === "POST" && url.pathname === "/v1/runs") {
    if (options.runControlStore === undefined && !usesJournalRunProjection) {
      throw new RequestError(409, "run_control_unavailable");
    }
    const parsed = createRunRequestSchema.safeParse(await readJson(request));
    if (!parsed.success) {
      throw new RequestError(400, "invalid_run_create_request");
    }
    if (options.journalRunAuthor !== undefined) {
      if (principal.kind !== "owner") {
        throw new RequestError(403, "local_writer_authority_required");
      }
      const signed = options.journalRunAuthor.createRun(parsed.data);
      sendJson(response, 201, {
        status: "authored",
        batchRef: `${signed.batch.writerStreamId}:${signed.batch.sequence}`,
      });
      return;
    }
    if (usesJournalRunProjection) {
      throw new RequestError(409, "local_writer_unavailable");
    }
    sendJson(response, 201, options.runControlStore?.createRun(parsed.data));
    return;
  }
  if (request.method === "GET" && url.pathname === "/v1/workspaces") {
    if (options.workspaceRegistry === undefined) {
      throw new RequestError(409, "workspace_registry_unavailable");
    }
    sendJson(response, 200, { workspaces: options.workspaceRegistry.list() });
    return;
  }
  const workspaceApprovalRoute =
    /^\/v1\/workspace-entry-requests\/([^/]+)\/approve$/.exec(url.pathname);
  if (request.method === "POST" && workspaceApprovalRoute !== null) {
    const runControlStore = options.runControlStore;
    if (
      options.workspaceRegistry === undefined ||
      runControlStore === undefined
    ) {
      throw new RequestError(409, "workspace_registry_unavailable");
    }
    const parsed = emptyRequestSchema.safeParse(await readJson(request));
    if (!parsed.success)
      throw new RequestError(400, "invalid_approval_request");
    const state = options.workspaceRegistry.approve(
      decodePathIdentity(workspaceApprovalRoute[1], "request_id"),
      (approved) =>
        runControlStore.createWorkspaceAffinity(approved.runId, {
          workspaceId: approved.workspace.id,
          policy: approved.workspace.recoveryPolicy,
        }),
    );
    sendJson(response, 200, state);
    return;
  }
  const runRoute =
    /^\/v1\/runs\/([^/]+)\/(control|events|commands|authority)$/.exec(
      url.pathname,
    );
  if (runRoute !== null) {
    if (options.runControlStore === undefined && !usesJournalRunProjection) {
      throw new RequestError(409, "run_control_unavailable");
    }
    const runId = decodePathIdentity(runRoute[1], "run_id");
    const resource = runRoute[2];
    if (request.method === "GET" && resource === "control") {
      sendJson(
        response,
        200,
        usesJournalRunProjection
          ? options.store.runSnapshot(runId, cursorFrom(url))
          : options.runControlStore?.snapshot(runId, cursorFrom(url)),
      );
      return;
    }
    if (request.method === "POST" && resource === "events") {
      const parsed = runEventRequestSchema.safeParse(await readJson(request));
      if (!parsed.success) {
        throw new RequestError(400, "invalid_run_event_request");
      }
      const input = {
        realmId: options.store.realmId(),
        runId,
        executorNodeId: principal.nodeId,
        ...parsed.data,
      };
      if (options.journalRunAuthor !== undefined) {
        if (principal.kind !== "owner") {
          throw new RequestError(403, "local_writer_authority_required");
        }
        const signed = options.journalRunAuthor.appendEvent(input);
        sendJson(response, 202, {
          status: "authored",
          batchRef: `${signed.batch.writerStreamId}:${signed.batch.sequence}`,
        });
        return;
      }
      if (usesJournalRunProjection) {
        throw new RequestError(409, "local_writer_unavailable");
      }
      sendJson(
        response,
        202,
        options.runControlStore?.appendExecutorEvent(input),
      );
      return;
    }
    if (request.method === "POST" && resource === "commands") {
      const parsed = runCommandRequestSchema.safeParse(await readJson(request));
      if (!parsed.success) {
        throw new RequestError(400, "invalid_run_command_request");
      }
      const input = {
        realmId: options.store.realmId(),
        runId,
        ...parsed.data,
      };
      if (options.journalRunAuthor !== undefined) {
        if (principal.kind !== "owner") {
          throw new RequestError(403, "local_writer_authority_required");
        }
        const signed = options.journalRunAuthor.submitCommand(input);
        sendJson(response, 202, {
          status: "authored",
          batchRef: `${signed.batch.writerStreamId}:${signed.batch.sequence}`,
        });
        return;
      }
      if (usesJournalRunProjection) {
        throw new RequestError(409, "local_writer_unavailable");
      }
      sendJson(response, 202, options.runControlStore?.submitCommand(input));
      return;
    }
    if (request.method === "GET" && resource === "commands") {
      const snapshot = usesJournalRunProjection
        ? options.store.runSnapshot(runId)
        : options.runControlStore?.snapshot(runId);
      if (snapshot === undefined) {
        throw new RequestError(409, "run_control_unavailable");
      }
      if (
        principal.kind === "node" &&
        principal.nodeId !== snapshot.executorNodeId
      ) {
        throw new RequestError(403, "executor_authority_required");
      }
      const after = cursorFrom(url);
      const commands = usesJournalRunProjection
        ? options.store.runCommandsAfter(runId, after)
        : (options.runControlStore?.commandsAfter(runId, after) ?? []);
      sendJson(response, 200, {
        cursor: commands.at(-1)?.commandSequence ?? after,
        commands: commands.filter(
          (command) => command.authorityEpoch === snapshot.authorityEpoch,
        ),
      });
      return;
    }
    if (request.method === "POST" && resource === "authority") {
      const parsed = transferRunAuthorityRequestSchema.safeParse(
        await readJson(request),
      );
      if (!parsed.success) {
        throw new RequestError(400, "invalid_run_authority_request");
      }
      if (options.journalRunAuthor !== undefined) {
        if (principal.kind !== "owner") {
          throw new RequestError(403, "local_writer_authority_required");
        }
        const signed = options.journalRunAuthor.transferAuthority({
          runId,
          ...parsed.data,
        });
        sendJson(response, 202, {
          status: "authored",
          batchRef: `${signed.batch.writerStreamId}:${signed.batch.sequence}`,
        });
        return;
      }
      if (usesJournalRunProjection) {
        throw new RequestError(409, "local_writer_unavailable");
      }
      sendJson(
        response,
        202,
        options.runControlStore?.transferAuthority(runId, parsed.data),
      );
      return;
    }
  }
  const workspaceRoute =
    /^\/v1\/runs\/([^/]+)\/workspace(?:\/(enter|exit|binding|unavailable|recovered|choice))?$/.exec(
      url.pathname,
    );
  if (workspaceRoute !== null) {
    if (options.runControlStore === undefined) {
      throw new RequestError(409, "run_control_unavailable");
    }
    const runId = decodePathIdentity(workspaceRoute[1], "run_id");
    const action = workspaceRoute[2];
    if (request.method === "GET" && action === "binding") {
      if (options.workspaceRegistry === undefined) {
        throw new RequestError(409, "workspace_registry_unavailable");
      }
      const state = options.runControlStore.workspaceRecoveryState(runId);
      if (
        principal.kind !== "node" ||
        principal.nodeId !== state.activeExecutorNodeId
      ) {
        throw new RequestError(403, "executor_authority_required");
      }
      if (!state.workspaceAttached) {
        throw new RequestError(409, "workspace_not_attached");
      }
      try {
        sendJson(
          response,
          200,
          await options.workspaceRegistry.binding(state.workspaceId),
        );
      } catch (error) {
        if (error instanceof WorkspaceUnavailableError) {
          throw new RequestError(409, "workspace_unavailable");
        }
        throw error;
      }
      return;
    }
    if (request.method === "POST" && action === "enter") {
      if (options.workspaceRegistry === undefined) {
        throw new RequestError(409, "workspace_registry_unavailable");
      }
      const parsed = workspaceEntryRequestSchema.safeParse(
        await readJson(request),
      );
      if (!parsed.success) {
        throw new RequestError(400, "invalid_workspace_entry_request");
      }
      const existing =
        options.runControlStore.workspaceRecoveryStateIfPresent(runId);
      if (existing !== null) {
        if (existing.workspaceId !== parsed.data.workspaceId) {
          throw new RequestError(409, "run_has_different_workspace");
        }
        if (existing.mode === "exited") {
          throw new RequestError(409, "workspace_already_exited");
        }
        sendJson(response, 200, { status: "already-entered", state: existing });
        return;
      }
      const decision = options.workspaceRegistry.requestEntry(
        runId,
        parsed.data.workspaceId,
      );
      if (decision.status === "approval-required") {
        sendJson(response, 202, decision);
        return;
      }
      sendJson(
        response,
        201,
        options.runControlStore.createWorkspaceAffinity(runId, {
          workspaceId: decision.workspace.id,
          policy: decision.workspace.recoveryPolicy,
        }),
      );
      return;
    }
    if (request.method === "POST" && action === "exit") {
      const parsed = emptyRequestSchema.safeParse(await readJson(request));
      if (!parsed.success) {
        throw new RequestError(400, "invalid_workspace_exit_request");
      }
      sendJson(response, 202, options.runControlStore.exitWorkspace(runId));
      return;
    }
    if (request.method === "GET" && action === undefined) {
      sendJson(
        response,
        200,
        options.runControlStore.workspaceRecoveryState(runId),
      );
      return;
    }
    if (request.method === "POST" && action === undefined) {
      if (options.workspaceRegistry !== undefined) {
        throw new RequestError(409, "enter_workspace_tool_required");
      }
      const parsed = workspaceAffinityRequestSchema.safeParse(
        await readJson(request),
      );
      if (!parsed.success) {
        throw new RequestError(400, "invalid_workspace_affinity_request");
      }
      sendJson(
        response,
        201,
        options.runControlStore.createWorkspaceAffinity(runId, parsed.data),
      );
      return;
    }
    if (request.method === "POST" && action === "unavailable") {
      const parsed = workspaceUnavailableRequestSchema.safeParse(
        await readJson(request),
      );
      if (!parsed.success) {
        throw new RequestError(400, "invalid_workspace_unavailable_request");
      }
      sendJson(
        response,
        202,
        options.runControlStore.executorUnavailable(runId, parsed.data),
      );
      return;
    }
    if (request.method === "POST" && action === "recovered") {
      const parsed = emptyRequestSchema.safeParse(await readJson(request));
      if (!parsed.success) {
        throw new RequestError(400, "invalid_workspace_recovered_request");
      }
      sendJson(
        response,
        202,
        options.runControlStore.preferredExecutorRecovered(runId),
      );
      return;
    }
    if (request.method === "POST" && action === "choice") {
      const parsed = workspaceRecoveryChoiceRequestSchema.safeParse(
        await readJson(request),
      );
      if (!parsed.success) {
        throw new RequestError(400, "invalid_workspace_recovery_choice");
      }
      const { action: selectedAction, ...context } = parsed.data;
      sendJson(
        response,
        202,
        options.runControlStore.chooseWorkspaceRecovery(
          runId,
          selectedAction,
          context,
        ),
      );
      return;
    }
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
    const enrolledNode =
      suppliedCredential === null
        ? null
        : (options.enrollmentRegistry?.authenticate(suppliedCredential) ??
          null);
    const principal: RequestPrincipal | null = ownerAuthenticated
      ? { kind: "owner", nodeId: options.nodeId }
      : enrolledNode === null
        ? null
        : {
            kind: "node",
            nodeId: enrolledNode.nodeId,
            keyId: enrolledNode.keyId,
            scopes: enrolledNode.scopes,
          };
    if (principal === null) {
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
    const requirement = routeRequirement(request);
    if (
      principal.kind === "node" &&
      (requirement === "owner" ||
        (requirement !== null && !principal.scopes.includes(requirement)))
    ) {
      sendJson(response, 403, { error: "forbidden" });
      return;
    }
    void handleAuthorizedRequest(request, response, options, principal).catch(
      (error) => {
        if (error instanceof RequestError) {
          sendJson(response, error.status, { error: error.code });
          return;
        }
        sendJson(response, 409, { error: "operation_rejected" });
      },
    );
  });
}
