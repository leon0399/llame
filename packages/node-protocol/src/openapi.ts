import { isRecord, type UnknownRecord } from "@workspace/runtime-safety";
import { QUERY_METHODS } from "./queries";
import {
  NODE_REQUEST_PATH,
  NODE_PRINCIPAL_HEADER,
  NODE_VERSION_HEADER,
  NODE_REQUEST_MAX_BYTES,
} from "./core";

export interface NodeOpenApiSchema {
  readonly type?: string;
  readonly format?: string;
  readonly nullable?: boolean;
  readonly additionalProperties?: boolean | NodeOpenApiSchema;
  readonly required?: ReadonlyArray<string>;
  readonly properties?: NodeOpenApiSchemaMap;
  readonly items?: NodeOpenApiSchema;
  readonly enum?: ReadonlyArray<string | number | boolean>;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly default?: number;
  readonly description?: string;
  readonly uniqueItems?: boolean;
  readonly oneOf?: ReadonlyArray<NodeOpenApiSchema>;
  readonly $ref?: string;
}

export interface NodeOpenApiSchemaMap {
  readonly [name: string]: NodeOpenApiSchema;
}

export interface NodeProtocolSchemas {
  readonly NodeDescription: NodeOpenApiSchema;
  readonly NodeObservation: NodeOpenApiSchema;
}

export interface NodeAdmissionSchemas {
  readonly CreateNodeRunDto: UnknownRecord;
  readonly AcceptedNodeRunResponse: NodeOpenApiSchema;
}

const uuid = { type: "string", format: "uuid" } as const;
const range = {
  offset: {
    type: "integer",
    minimum: 0,
    maximum: Number.MAX_SAFE_INTEGER,
    default: 0,
  },
  limit: { type: "integer", minimum: 1, maximum: 2000, default: 100 },
} as const;
const search = {
  type: "object",
  additionalProperties: false,
  required: ["query"],
  properties: {
    query: { type: "string", minLength: 1, maxLength: 200 },
    limit: { type: "integer", minimum: 1, maximum: 10, default: 5 },
  },
} as const;

function conversationReadParams() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["chatId", "messageSeq"],
    properties: {
      chatId: uuid,
      messageSeq: {
        type: "integer",
        minimum: 1,
        maximum: Number.MAX_SAFE_INTEGER,
      },
      ...range,
    },
  };
}

function knowledgeReadParams() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["knowledgeSpaceId", "path"],
    properties: {
      knowledgeSpaceId: uuid,
      path: {
        type: "string",
        minLength: 1,
        maxLength: 1024,
        description:
          "Relative path within the authorized Knowledge Space; absolute paths, dot components and backslashes are rejected.",
      },
      ...range,
    },
  };
}

function methodParams() {
  return {
    "core.describe": {
      type: "object",
      additionalProperties: false,
      properties: {},
    },
    "realm.conversations.search": search,
    "realm.conversations.read": conversationReadParams(),
    "realm.knowledge.search": search,
    "realm.knowledge.read": knowledgeReadParams(),
  };
}

function httpErrorResponses() {
  return {
    "400": { description: "Malformed request" },
    "401": { description: "Session required" },
    "429": { description: "Rate limit exceeded" },
  };
}

function versionHeader() {
  return {
    name: NODE_VERSION_HEADER,
    in: "header",
    required: true,
    schema: { type: "string", enum: ["1"] },
  };
}

function principalHeader(required: boolean, description: string) {
  return {
    name: NODE_PRINCIPAL_HEADER,
    in: "header",
    required,
    schema: uuid,
    description,
  };
}

function requestMethodSchema(method: string, schema: NodeOpenApiSchema) {
  return {
    type: "object",
    additionalProperties: false,
    required:
      method === "core.describe"
        ? ["jsonrpc", "id", "method"]
        : ["jsonrpc", "id", "method", "params"],
    properties: {
      jsonrpc: { type: "string", enum: ["2.0"] },
      id: { type: "string", minLength: 1, maxLength: 100 },
      method: { type: "string", enum: [method] },
      params: schema,
    },
  };
}

function jsonRpcSuccessSchema() {
  return {
    type: "object",
    required: ["jsonrpc", "id", "result"],
    properties: {
      jsonrpc: { type: "string", enum: ["2.0"] },
      id: { type: "string" },
      result: {
        oneOf: [
          { $ref: "#/components/schemas/NodeDescription" },
          { $ref: "#/components/schemas/NodeObservation" },
        ],
      },
    },
  };
}

function jsonRpcErrorSchema() {
  return {
    type: "object",
    required: ["jsonrpc", "id", "error"],
    properties: {
      jsonrpc: { type: "string", enum: ["2.0"] },
      id: { type: "string", nullable: true },
      error: {
        type: "object",
        required: ["code", "message", "data"],
        properties: {
          code: { type: "integer" },
          message: { type: "string" },
          data: {
            type: "object",
            required: ["code", "exitCode"],
            properties: {
              code: { type: "string" },
              exitCode: { type: "integer" },
            },
          },
        },
      },
    },
  };
}

function nodeRequestResponses() {
  return {
    ...httpErrorResponses(),
    "200": {
      description:
        "Correlated JSON-RPC result or sanitized error. Retrieval result binds method, authenticated principal and source; data preserves native bounded evidence, not identical ranking across deployments.",
      content: {
        "application/json": {
          schema: { oneOf: [jsonRpcSuccessSchema(), jsonRpcErrorSchema()] },
        },
      },
    },
  };
}

function nodeRequestOperation() {
  return {
    operationId: "nodeOwnerRequest",
    tags: ["node"],
    security: [{ bearer: [] }, { cookie: [] }],
    summary:
      "Versioned Node discovery and owner-scoped retrieval; never arbitrary tools or local administration",
    description: `Maximum request body: ${NODE_REQUEST_MAX_BYTES} bytes. No batches, notifications, user-selected principals or transparent fallback. Capability and schema errors use a correlated JSON-RPC error.`,
    parameters: [
      versionHeader(),
      principalHeader(
        false,
        "Expected authenticated subject, required except on initial core.describe. It asserts identity; it never selects an owner.",
      ),
    ],
    requestBody: {
      required: true,
      content: {
        "application/json": {
          schema: {
            oneOf: Object.entries(methodParams()).map(([method, schema]) =>
              requestMethodSchema(method, schema),
            ),
          },
        },
      },
    },
    responses: nodeRequestResponses(),
  };
}

function nodeRunResponses() {
  return {
    ...httpErrorResponses(),
    "202": {
      description:
        "Run accepted and dispatched; it may already have progressed",
      headers: {
        Location: {
          description: "Relative Run resource URL",
          schema: { type: "string" },
        },
      },
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/AcceptedNodeRunResponse" },
        },
      },
    },
    "404": { description: "Chat not found or not owned" },
    "409": { description: "Duplicate message ID or another Run is in flight" },
    "422": {
      description: "Model or effort unavailable",
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/ModelDomainErrorResponse" },
        },
      },
    },
    "503": {
      description: "Model configuration unavailable",
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/ModelDomainErrorResponse" },
        },
      },
    },
  };
}

function nodeRunOperation() {
  return {
    operationId: "createNodeRun",
    tags: ["runs"],
    security: [{ bearer: [] }, { cookie: [] }],
    parameters: [
      versionHeader(),
      principalHeader(
        true,
        "Expected authenticated subject, not owner selection.",
      ),
    ],
    summary:
      "Admit an owner message and queue its durable Run, independently of event attachment",
    description:
      "Same acceptance transaction and dispatcher as createChatMessage. Disconnect does not cancel execution. Duplicate message IDs conflict; clients must not automatically retry an uncertain submission.",
    requestBody: {
      required: true,
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/CreateNodeRunDto" },
        },
      },
    },
    responses: nodeRunResponses(),
  };
}

/** Shared protocol transport schemas used by BOTH the live and checked-in OpenAPI. */
export function nodeOpenApiPaths() {
  return {
    [NODE_REQUEST_PATH]: { post: nodeRequestOperation() },
    "/api/v1/runs": { post: nodeRunOperation() },
  };
}

/** Extends the emitted existing message schema, not a copied parallel message contract. */
export function nodeAdmissionSchemas(
  message: UnknownRecord,
): NodeAdmissionSchemas {
  if (!isRecord(message.properties) || !Array.isArray(message.required))
    throw new Error("Missing generated CreateMessageDto schema.");
  return {
    CreateNodeRunDto: {
      ...message,
      properties: { ...message.properties, chatId: uuid },
      required: [...message.required, "chatId"],
    },
    AcceptedNodeRunResponse: {
      type: "object",
      properties: { runId: uuid, chatId: uuid, messageId: uuid },
      required: ["runId", "chatId", "messageId"],
    },
  };
}

function principalSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["kind", "id"],
    properties: {
      kind: { type: "string", enum: ["local-owner", "session-user"] },
      id: uuid,
    },
  };
}

const disabledFlag = { type: "boolean", enum: [false] } as const;
const nodeKind = {
  type: "string",
  enum: ["personal-node", "shared-instance"],
} as const;

function recallSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["strategy", "minimumQueryCharacters"],
    properties: {
      strategy: {
        type: "string",
        enum: ["literal-trigram", "canonical-postgres"],
      },
      minimumQueryCharacters: { type: "integer", enum: [1, 3] },
    },
  };
}

function modulesSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["core", "realm"],
    properties: {
      core: { type: "integer", enum: [1] },
      realm: { type: "integer", enum: [1] },
    },
  };
}

function nodeDescriptionSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: [
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
    ],
    properties: {
      version: { type: "integer", enum: [1] },
      kind: nodeKind,
      nodeId: { ...uuid, nullable: true },
      principal: principalSchema(),
      modules: modulesSchema(),
      methods: {
        type: "array",
        uniqueItems: true,
        items: { type: "string", enum: ["core.describe", ...QUERY_METHODS] },
      },
      execution: { type: "string", enum: ["private-ipc", "hosted-queued"] },
      synchronization: disabledFlag,
      enrollment: disabledFlag,
      recall: recallSchema(),
      knowledge: { type: "string", enum: ["live-markdown"] },
    },
  };
}

function nodeObservationSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["version", "method", "principal", "source", "data"],
    properties: {
      version: { type: "integer", enum: [1] },
      method: { type: "string", enum: [...QUERY_METHODS] },
      principal: principalSchema(),
      source: {
        type: "object",
        additionalProperties: false,
        required: ["kind", "nodeId", "synchronized"],
        properties: {
          kind: nodeKind,
          nodeId: { ...uuid, nullable: true },
          synchronized: disabledFlag,
        },
      },
      data: {
        type: "object",
        required: ["status"],
        properties: {
          status: { type: "string", enum: ["success", "error"] },
        },
        additionalProperties: true,
        description:
          "Bounded native observation from the existing canonical operation, including its evidence, notice and coverage. Not identical search scoring or source formatting.",
      },
    },
  };
}

export function nodeProtocolSchemas(): NodeProtocolSchemas {
  return {
    NodeDescription: nodeDescriptionSchema(),
    NodeObservation: nodeObservationSchema(),
  };
}
