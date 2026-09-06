import {
  isRecord,
  isString,
  type UnknownRecord,
} from "@workspace/runtime-safety";
import { NodeProtocolError } from "./errors";
import { exactKeys, object, string, uuid } from "./validation";
import { isQueryMethod, type QueryMethod } from "./queries";

export const NODE_API_VERSION = 1;
export const NODE_REQUEST_MAX_BYTES = 32_768;
export const NODE_RESULT_MAX_BYTES = 131_072;
export const NODE_REQUEST_PATH = "/api/v1/node/requests";
export const NODE_PRINCIPAL_HEADER = "x-llame-node-principal";
export const NODE_VERSION_HEADER = "x-llame-node-version";
const NODE_DESCRIPTION_KEYS = [
  "version",
  "kind",
  "nodeId",
  "principal",
  "modules",
  "methods",
  "execution",
  "synchronization",
  "enrollment",
  "recall",
  "knowledge",
];
export interface NodePrincipal {
  readonly kind: "local-owner" | "session-user";
  readonly id: string;
}
export interface NodeDescription {
  readonly version: 1;
  readonly kind: "personal-node" | "shared-instance";
  /** Hosted account access is not a cryptographically enrolled replica identity. */
  readonly nodeId: string | null;
  readonly principal: NodePrincipal;
  readonly modules: { readonly core: 1; readonly realm: 1 };
  readonly methods: ReadonlyArray<"core.describe" | QueryMethod>;
  readonly execution: "private-ipc" | "hosted-queued";
  readonly synchronization: false;
  readonly enrollment: false;
  readonly recall: {
    readonly strategy: "literal-trigram" | "canonical-postgres";
    readonly minimumQueryCharacters: number;
  };
  readonly knowledge: "live-markdown";
}
export interface NodeObservation {
  readonly version: 1;
  readonly method: QueryMethod;
  readonly principal: NodePrincipal;
  readonly source: {
    readonly kind: NodeDescription["kind"];
    readonly nodeId: string | null;
    readonly synchronized: false;
  };
  /** Native bounded evidence. Ranking and coverage are explicitly deployment-specific. */
  readonly data: UnknownRecord;
}
export type NodeOperationResult = NodeDescription | NodeObservation;
export interface NodeRequest {
  readonly jsonrpc: "2.0";
  readonly id: string;
  readonly method: string;
  readonly params: UnknownRecord;
}
export function parseNodeRequest(value: unknown): NodeRequest {
  if (!isRecord(value))
    throw new NodeProtocolError("invalid_params", "Expected an object.");
  exactKeys(value, ["jsonrpc", "id", "method", "params"]);
  if (value.jsonrpc !== "2.0")
    throw new NodeProtocolError(
      "invalid_request",
      "Expected JSON-RPC 2.0.",
      -32_600,
    );
  return {
    jsonrpc: "2.0",
    id: string(value.id, "request ID", 100),
    method: string(value.method, "method", 100),
    params: object(value.params === undefined ? {} : value.params),
  };
}

function isAdvertisedMethod(
  method: unknown,
): method is "core.describe" | QueryMethod {
  if (!isString(method)) return false;
  return method === "core.describe" || isQueryMethod(method);
}

function requireVersionedKind(value: UnknownRecord): NodeDescription["kind"] {
  if (
    value.version !== 1 ||
    (value.kind !== "personal-node" && value.kind !== "shared-instance")
  ) {
    throw new NodeProtocolError(
      "protocol_version",
      "Incompatible Node contract.",
    );
  }
  return value.kind;
}

function requirePrincipalKind(principal: UnknownRecord): NodePrincipal["kind"] {
  if (principal.kind !== "local-owner" && principal.kind !== "session-user")
    throw new NodeProtocolError("principal_invalid", "Invalid Node principal.");
  return principal.kind;
}

function requireModules(modules: UnknownRecord): void {
  if (modules.core !== 1 || modules.realm !== 1)
    throw new NodeProtocolError(
      "protocol_version",
      "Required Node modules are unavailable.",
    );
}

function requireMethods(value: UnknownRecord): NodeDescription["methods"] {
  if (!Array.isArray(value.methods) || !value.methods.every(isAdvertisedMethod))
    throw new NodeProtocolError(
      "capabilities_invalid",
      "Invalid Node methods.",
    );
  const methods = value.methods;
  if (
    new Set(methods).size !== methods.length ||
    !methods.includes("core.describe")
  ) {
    throw new NodeProtocolError(
      "capabilities_invalid",
      "Invalid Node methods.",
    );
  }
  return methods;
}

interface NodeCapabilityFields {
  readonly strategy: "literal-trigram" | "canonical-postgres";
  readonly minimumQueryCharacters: 1 | 3;
  readonly execution: NodeDescription["execution"];
}

function requireCapabilities(
  value: UnknownRecord,
  recall: UnknownRecord,
): NodeCapabilityFields {
  if (
    (recall.strategy !== "literal-trigram" &&
      recall.strategy !== "canonical-postgres") ||
    (recall.minimumQueryCharacters !== 1 &&
      recall.minimumQueryCharacters !== 3) ||
    value.synchronization !== false ||
    value.enrollment !== false ||
    value.knowledge !== "live-markdown" ||
    (value.execution !== "private-ipc" && value.execution !== "hosted-queued")
  ) {
    throw new NodeProtocolError(
      "capabilities_invalid",
      "Unsupported Node capability contract.",
    );
  }
  return {
    strategy: recall.strategy,
    minimumQueryCharacters: recall.minimumQueryCharacters,
    execution: value.execution,
  };
}

function requireDeploymentMatch(
  value: UnknownRecord,
  principal: UnknownRecord,
): void {
  if (
    (value.kind === "personal-node" &&
      (principal.kind !== "local-owner" ||
        value.nodeId !== principal.id ||
        value.execution !== "private-ipc")) ||
    (value.kind === "shared-instance" &&
      (principal.kind !== "session-user" ||
        value.nodeId !== null ||
        value.execution !== "hosted-queued"))
  ) {
    throw new NodeProtocolError(
      "principal_invalid",
      "Node identity and principal do not match the advertised deployment.",
    );
  }
}

export function nodeDescription(input: unknown): NodeDescription {
  if (!isRecord(input))
    throw new NodeProtocolError("invalid_params", "Expected an object.");
  exactKeys(input, NODE_DESCRIPTION_KEYS);
  const kind = requireVersionedKind(input);
  const principal = object(input.principal);
  exactKeys(principal, ["kind", "id"]);
  const principalKind = requirePrincipalKind(principal);
  const modules = object(input.modules);
  exactKeys(modules, ["core", "realm"]);
  requireModules(modules);
  const methods = requireMethods(input);
  const recall = object(input.recall);
  exactKeys(recall, ["strategy", "minimumQueryCharacters"]);
  const capabilities = requireCapabilities(input, recall);
  requireDeploymentMatch(input, principal);
  return {
    version: 1,
    kind,
    nodeId: input.nodeId === null ? null : uuid(input.nodeId),
    principal: { kind: principalKind, id: uuid(principal.id) },
    modules: { core: 1, realm: 1 },
    methods,
    execution: capabilities.execution,
    synchronization: false,
    enrollment: false,
    recall: {
      strategy: capabilities.strategy,
      minimumQueryCharacters: capabilities.minimumQueryCharacters,
    },
    knowledge: "live-markdown",
  };
}
