import { type UnknownRecord, isRecord } from '@workspace/runtime-safety';
import { QUERY_METHODS } from './queries';
import { NODE_REQUEST_PATH, NODE_PRINCIPAL_HEADER, NODE_VERSION_HEADER, NODE_REQUEST_MAX_BYTES } from './core';

const uuid = { type: 'string', format: 'uuid' };
const range = { offset: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER, default: 0 },
  limit: { type: 'integer', minimum: 1, maximum: 2000, default: 100 } };
const search = { type: 'object', additionalProperties: false, required: ['query'], properties: {
  query: { type: 'string', minLength: 1, maxLength: 200 }, limit: { type: 'integer', minimum: 1, maximum: 10, default: 5 },
} };
const params: Readonly<Record<string, UnknownRecord>> = {
  'core.describe': { type: 'object', additionalProperties: false, properties: {} },
  'realm.conversations.search': search,
  'realm.conversations.read': { type: 'object', additionalProperties: false, required: ['chatId', 'messageSeq'], properties: {
    chatId: uuid, messageSeq: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER }, ...range,
  } },
  'realm.knowledge.search': search,
  'realm.knowledge.read': { type: 'object', additionalProperties: false, required: ['knowledgeSpaceId', 'path'], properties: {
    knowledgeSpaceId: uuid, path: { type: 'string', minLength: 1, maxLength: 1024,
      description: 'Relative path within the authorized Knowledge Space; absolute paths, dot components and backslashes are rejected.' }, ...range,
  } },
};

/** Shared protocol transport schemas used by BOTH the live and checked-in OpenAPI. */
export function nodeOpenApiPaths(): Record<string, UnknownRecord> {
  const security = [{ bearer: [] }, { cookie: [] }];
  const errors = { '400': { description: 'Malformed request' }, '401': { description: 'Session required' }, '429': { description: 'Rate limit exceeded' } };
  return {
    [NODE_REQUEST_PATH]: { post: {
      operationId: 'nodeOwnerRequest', tags: ['node'], security,
      summary: 'Versioned Node discovery and owner-scoped retrieval; never arbitrary tools or local administration',
      description: `Maximum request body: ${NODE_REQUEST_MAX_BYTES} bytes. No batches, notifications, user-selected principals or transparent fallback. Capability and schema errors use a correlated JSON-RPC error.`,
      parameters: [
        { name: NODE_VERSION_HEADER, in: 'header', required: true, schema: { type: 'string', enum: ['1'] } },
        { name: NODE_PRINCIPAL_HEADER, in: 'header', required: false, schema: uuid,
          description: 'Expected authenticated subject, required except on initial core.describe. It asserts identity; it never selects an owner.' },
      ],
      requestBody: { required: true, content: { 'application/json': { schema: {
        oneOf: Object.entries(params).map(([method, schema]) => ({ type: 'object', additionalProperties: false,
          required: method === 'core.describe' ? ['jsonrpc', 'id', 'method'] : ['jsonrpc', 'id', 'method', 'params'], properties: { jsonrpc: { type: 'string', enum: ['2.0'] },
            id: { type: 'string', minLength: 1, maxLength: 100 }, method: { type: 'string', enum: [method] }, params: schema },
        })),
      } } } },
      responses: { ...errors, '200': { description: 'Correlated JSON-RPC result or sanitized error. Retrieval result binds method, authenticated principal and source; data preserves native bounded evidence, not identical ranking across deployments.',
        content: { 'application/json': { schema: { oneOf: [
          { type: 'object', required: ['jsonrpc', 'id', 'result'], properties: { jsonrpc: { type: 'string', enum: ['2.0'] }, id: { type: 'string' }, result: { oneOf: [{ $ref: '#/components/schemas/NodeDescription' }, { $ref: '#/components/schemas/NodeObservation' }] } } },
          { type: 'object', required: ['jsonrpc', 'id', 'error'], properties: { jsonrpc: { type: 'string', enum: ['2.0'] }, id: { type: 'string', nullable: true }, error: { type: 'object', required: ['code', 'message', 'data'], properties: {
            code: { type: 'integer' }, message: { type: 'string' }, data: { type: 'object', required: ['code', 'exitCode'], properties: { code: { type: 'string' }, exitCode: { type: 'integer' } } },
          } } } },
        ] } } },
      } },
    } },
    '/api/v1/runs': { post: {
      operationId: 'createNodeRun', tags: ['runs'], security,
      parameters: [
        { name: NODE_VERSION_HEADER, in: 'header', required: true, schema: { type: 'string', enum: ['1'] } },
        { name: NODE_PRINCIPAL_HEADER, in: 'header', required: true, schema: uuid, description: 'Expected authenticated subject, not owner selection.' },
      ],
      summary: 'Admit an owner message and queue its durable Run, independently of event attachment',
      description: 'Same acceptance transaction and dispatcher as createChatMessage. Disconnect does not cancel execution. Duplicate message IDs conflict; clients must not automatically retry an uncertain submission.',
      requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateNodeRunDto' } } } },
      responses: { ...errors,
        '202': { description: 'Run accepted and dispatched; it may already have progressed', headers: { Location: { description: 'Relative Run resource URL', schema: { type: 'string' } } },
          content: { 'application/json': { schema: { $ref: '#/components/schemas/AcceptedNodeRunResponse' } } } },
        '404': { description: 'Chat not found or not owned' }, '409': { description: 'Duplicate message ID or another Run is in flight' },
        '422': { description: 'Model or effort unavailable', content: { 'application/json': { schema: { $ref: '#/components/schemas/ModelDomainErrorResponse' } } } },
        '503': { description: 'Model configuration unavailable', content: { 'application/json': { schema: { $ref: '#/components/schemas/ModelDomainErrorResponse' } } } },
      },
    } },
  };
}

/** Extends the emitted existing message schema, not a copied parallel message contract. */
export function nodeAdmissionSchemas(message: UnknownRecord): Record<string, UnknownRecord> {
  if (!isRecord(message.properties) || !Array.isArray(message.required)) throw new Error('Missing generated CreateMessageDto schema.');
  return {
    CreateNodeRunDto: { ...message, properties: { ...message.properties, chatId: uuid }, required: [...message.required, 'chatId'] },
    AcceptedNodeRunResponse: { type: 'object', properties: { runId: uuid, chatId: uuid, messageId: uuid }, required: ['runId', 'chatId', 'messageId'] },
  };
}

export function nodeProtocolSchemas(): Record<string, UnknownRecord> {
  const principal = { type: 'object', additionalProperties: false, required: ['kind', 'id'], properties: {
    kind: { type: 'string', enum: ['local-owner', 'session-user'] }, id: uuid,
  } };
  const nodeId = { ...uuid, nullable: true };
  const kind = { type: 'string', enum: ['personal-node', 'shared-instance'] };
  const disabled = { type: 'boolean', enum: [false] };
  return {
    NodeDescription: { type: 'object', required: ['version', 'kind', 'nodeId', 'principal', 'modules', 'methods', 'execution', 'synchronization', 'enrollment', 'recall', 'knowledge'], properties: {
      version: { type: 'integer', enum: [1] }, kind, nodeId, principal,
      modules: { type: 'object', required: ['core', 'realm'], properties: { core: { type: 'integer', enum: [1] }, realm: { type: 'integer', enum: [1] } } },
      methods: { type: 'array', uniqueItems: true, items: { type: 'string', enum: ['core.describe', ...QUERY_METHODS] } },
      execution: { type: 'string', enum: ['private-ipc', 'hosted-queued'] }, synchronization: disabled, enrollment: disabled,
      recall: { type: 'object', required: ['strategy', 'minimumQueryCharacters'], properties: {
        strategy: { type: 'string', enum: ['literal-trigram', 'canonical-postgres'] }, minimumQueryCharacters: { type: 'integer', enum: [1, 3] },
      } }, knowledge: { type: 'string', enum: ['live-markdown'] },
    } },
    NodeObservation: { type: 'object', additionalProperties: false, required: ['version', 'method', 'principal', 'source', 'data'], properties: {
      version: { type: 'integer', enum: [1] }, method: { type: 'string', enum: [...QUERY_METHODS] }, principal,
      source: { type: 'object', additionalProperties: false, required: ['kind', 'nodeId', 'synchronized'], properties: { kind, nodeId, synchronized: disabled } },
      data: { type: 'object', required: ['status'], properties: { status: { type: 'string', enum: ['success', 'error'] } }, additionalProperties: true,
        description: 'Bounded native observation from the existing canonical operation, including its evidence, notice and coverage. Not identical search scoring or source formatting.' },
    } },
  };
}
