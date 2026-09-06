import { type UnknownRecord, isRecord } from "@workspace/runtime-safety";
import {
  nodeDescription,
  type NodeDescription,
  type NodeRequest,
  type NodeOperationResult,
  type NodeObservation,
  NODE_REQUEST_MAX_BYTES,
  NODE_RESULT_MAX_BYTES,
} from "./core";
import { NodeProtocolError, protocolError } from "./errors";
import { queryParams, type NodeQuery } from "./queries";
import { exactKeys } from "./validation";

export interface NodeAccessPort {
  describe(): NodeDescription;
  query(query: NodeQuery, signal: AbortSignal): Promise<UnknownRecord>;
}

function assertNotCancelled(signal: AbortSignal): void {
  if (signal.aborted)
    throw new NodeProtocolError("cancelled", "Node request cancelled.");
}

/** Bound the caller even when a port's underlying I/O ignores the signal. */
function withCancellation<T>(
  promise: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = () =>
      reject(new NodeProtocolError("cancelled", "Node request cancelled."));
    if (signal.aborted) {
      onAbort();
    } else {
      signal.addEventListener("abort", onAbort, { once: true });
    }
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

function assertRequestSize(
  request: Pick<NodeRequest, "method" | "params">,
): void {
  if (Buffer.byteLength(JSON.stringify(request)) > NODE_REQUEST_MAX_BYTES)
    throw new NodeProtocolError("request_limit", "Node request is too large.");
}

function assertResultSize(result: NodeOperationResult): void {
  if (Buffer.byteLength(JSON.stringify(result)) > NODE_RESULT_MAX_BYTES) {
    throw new NodeProtocolError(
      "result_limit",
      "Node query exceeded its bounded result size.",
      -32_603,
    );
  }
}

async function queryObservation(
  request: Pick<NodeRequest, "method" | "params">,
  port: NodeAccessPort,
  description: NodeDescription,
  signal: AbortSignal,
): Promise<NodeObservation> {
  const query = queryParams(request.method, request.params);
  if (!description.methods.includes(query.method)) {
    throw new NodeProtocolError(
      "capability_unavailable",
      "This Node does not authorize the requested capability.",
      -32_601,
    );
  }
  const data = await withCancellation(port.query(query, signal), signal);
  if (
    !isRecord(data) ||
    (data.status !== "success" && data.status !== "error")
  ) {
    throw new NodeProtocolError(
      "result_invalid",
      "Node query returned an invalid observation.",
      -32_603,
    );
  }
  return {
    version: 1,
    method: query.method,
    principal: description.principal,
    source: {
      kind: description.kind,
      nodeId: description.nodeId,
      synchronized: false,
    },
    data,
  };
}

/** The host supplies the authenticated owner-bound port; request data never does. */
export async function accessOperation(
  request: Pick<NodeRequest, "method" | "params">,
  port: NodeAccessPort,
  signal: AbortSignal,
): Promise<NodeOperationResult> {
  assertNotCancelled(signal);
  assertRequestSize(request);
  const description = nodeDescription(port.describe());
  if (request.method === "core.describe") exactKeys(request.params, []);
  const result =
    request.method === "core.describe"
      ? description
      : await queryObservation(request, port, description, signal);
  assertNotCancelled(signal);
  assertResultSize(result);
  return result;
}

export async function accessRequest(
  request: NodeRequest,
  port: NodeAccessPort,
  signal: AbortSignal,
) {
  try {
    return {
      jsonrpc: "2.0" as const,
      id: request.id,
      result: await accessOperation(request, port, signal),
    };
  } catch (error) {
    return {
      jsonrpc: "2.0" as const,
      id: request.id,
      error: protocolError(error),
    };
  }
}
