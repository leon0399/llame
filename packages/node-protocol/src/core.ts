import { type UnknownRecord } from '@workspace/runtime-safety';
import { NodeProtocolError } from './errors';
import { exactKeys, object, string, uuid } from './validation';
import { QUERY_METHODS, type QueryMethod } from './queries';

export const NODE_API_VERSION = 1;
export const NODE_REQUEST_MAX_BYTES = 32_768;
export const NODE_RESULT_MAX_BYTES = 131_072;
export const NODE_REQUEST_PATH = '/api/v1/node/requests';
export const NODE_PRINCIPAL_HEADER = 'x-llame-node-principal';
export const NODE_VERSION_HEADER = 'x-llame-node-version';
export interface NodePrincipal { readonly kind: 'local-owner' | 'session-user'; readonly id: string }
export interface NodeDescription {
  readonly version: 1;
  readonly kind: 'personal-node' | 'shared-instance';
  /** Hosted account access is not a cryptographically enrolled replica identity. */
  readonly nodeId: string | null;
  readonly principal: NodePrincipal;
  readonly modules: { readonly core: 1; readonly realm: 1 };
  readonly methods: readonly ('core.describe' | QueryMethod)[];
  readonly execution: 'private-ipc' | 'hosted-queued';
  readonly synchronization: false;
  readonly enrollment: false;
  readonly recall: { readonly strategy: 'literal-trigram' | 'canonical-postgres'; readonly minimumQueryCharacters: number };
  readonly knowledge: 'live-markdown';
}
export interface NodeObservation {
  readonly version: 1;
  readonly method: QueryMethod;
  readonly principal: NodePrincipal;
  readonly source: { readonly kind: NodeDescription['kind']; readonly nodeId: string | null; readonly synchronized: false };
  /** Native bounded evidence. Ranking and coverage are explicitly deployment-specific. */
  readonly data: UnknownRecord;
}
export type NodeOperationResult = NodeDescription | NodeObservation;
export interface NodeRequest {
  readonly jsonrpc: '2.0'; readonly id: string; readonly method: string; readonly params: UnknownRecord;
}
export function parseNodeRequest(value: unknown): NodeRequest {
  const input = object(value);
  exactKeys(input, ['jsonrpc', 'id', 'method', 'params']);
  if (input.jsonrpc !== '2.0') throw new NodeProtocolError('invalid_request', 'Expected JSON-RPC 2.0.', -32600);
  return { jsonrpc: '2.0', id: string(input.id, 'request ID', 100),
    method: string(input.method, 'method', 100), params: object(input.params === undefined ? {} : input.params) };
}
export function nodeDescription(input: unknown): NodeDescription {
  const value = object(input);
  if (value.version !== 1 || (value.kind !== 'personal-node' && value.kind !== 'shared-instance')) {
    throw new NodeProtocolError('protocol_version', 'Incompatible Node contract.');
  }
  const principal = object(value.principal);
  if (principal.kind !== 'local-owner' && principal.kind !== 'session-user') throw new NodeProtocolError('principal_invalid', 'Invalid Node principal.');
  const modules = object(value.modules);
  if (modules.core !== 1 || modules.realm !== 1) throw new NodeProtocolError('protocol_version', 'Required Node modules are unavailable.');
  if (!Array.isArray(value.methods) || !value.methods.every(method => method === 'core.describe' || QUERY_METHODS.includes(method)) ||
      new Set(value.methods).size !== value.methods.length || !value.methods.includes('core.describe')) {
    throw new NodeProtocolError('capabilities_invalid', 'Invalid Node methods.');
  }
  const recall = object(value.recall);
  if ((recall.strategy !== 'literal-trigram' && recall.strategy !== 'canonical-postgres') ||
      (recall.minimumQueryCharacters !== 1 && recall.minimumQueryCharacters !== 3) || value.synchronization !== false ||
      value.enrollment !== false || value.knowledge !== 'live-markdown' ||
      (value.execution !== 'private-ipc' && value.execution !== 'hosted-queued')) {
    throw new NodeProtocolError('capabilities_invalid', 'Unsupported Node capability contract.');
  }
  if ((value.kind === 'personal-node' && (principal.kind !== 'local-owner' || value.nodeId !== principal.id || value.execution !== 'private-ipc')) ||
      (value.kind === 'shared-instance' && (principal.kind !== 'session-user' || value.nodeId !== null || value.execution !== 'hosted-queued'))) {
    throw new NodeProtocolError('principal_invalid', 'Node identity and principal do not match the advertised deployment.');
  }
  return { version: 1, kind: value.kind, nodeId: value.nodeId === null ? null : uuid(value.nodeId),
    principal: { kind: principal.kind, id: uuid(principal.id) }, modules: { core: 1, realm: 1 }, methods: value.methods,
    execution: value.execution, synchronization: false, enrollment: false,
    recall: { strategy: recall.strategy, minimumQueryCharacters: recall.minimumQueryCharacters }, knowledge: 'live-markdown' };
}
