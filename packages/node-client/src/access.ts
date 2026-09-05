import { isRecord, type UnknownRecord } from '@workspace/runtime-safety';
import { nodeDescription, queryParams, NodeProtocolError, type NodeDescription, type NodeObservation, type QueryMethod } from '@workspace/node-protocol';
import { type NodeConnection } from './types';

export type { NodeObservation } from '@workspace/node-protocol';

/** Common owner-retrieval surface, independent of IPC/HTTP and terminal rendering. */
export class NodeAccessClient {
  constructor(private readonly connection: NodeConnection,
    private readonly expected: { readonly kind: NodeDescription['kind']; readonly principalId?: string }) {}

  async describe(signal: AbortSignal): Promise<NodeDescription> {
    const description = nodeDescription(await this.connection.call('core.describe', {}, signal));
    if (description.kind !== this.expected.kind ||
      (this.expected.principalId !== undefined && description.principal.id !== this.expected.principalId)) {
      throw new NodeProtocolError('principal_mismatch', 'The endpoint does not match the selected Node account.');
    }
    return description;
  }

  async query(method: QueryMethod, params: UnknownRecord, signal: AbortSignal): Promise<NodeObservation> {
    const query = queryParams(method, params);
    const description = await this.describe(signal);
    if (!description.methods.includes(method)) throw new NodeProtocolError('capability_unavailable', 'This Node does not authorize the requested capability.');
    if (query.method === 'realm.conversations.search' && [...query.params.query].length < description.recall.minimumQueryCharacters) {
      throw new NodeProtocolError('query_length', `This Node requires at least ${description.recall.minimumQueryCharacters} search characters.`);
    }
    const reply = await this.connection.call(method, query.params, signal);
    if (!isRecord(reply) || reply.version !== 1 || reply.method !== method || !isRecord(reply.principal) ||
      reply.principal.id !== description.principal.id || reply.principal.kind !== description.principal.kind ||
      !isRecord(reply.source) || reply.source.kind !== description.kind || reply.source.nodeId !== description.nodeId ||
      reply.source.synchronized !== false || !isRecord(reply.data) || (reply.data.status !== 'success' && reply.data.status !== 'error')) {
      throw new NodeProtocolError('result_binding', 'Node observation does not match its negotiated method and owner.');
    }
    return { version: 1, method, principal: description.principal,
      source: { kind: description.kind, nodeId: description.nodeId, synchronized: false }, data: reply.data };
  }
}
