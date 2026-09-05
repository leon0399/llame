import { type UnknownRecord, isRecord } from '@workspace/runtime-safety';
import { type NodeDescription, type NodeRequest, type NodeOperationResult, NODE_REQUEST_MAX_BYTES, NODE_RESULT_MAX_BYTES } from './core';
import { NodeProtocolError, protocolError } from './errors';
import { queryParams, type NodeQuery } from './queries';
import { exactKeys } from './validation';

export interface NodeAccessPort {
  describe(): NodeDescription;
  query(query: NodeQuery, signal: AbortSignal): Promise<UnknownRecord>;
}
/** The host supplies the authenticated owner-bound port; request data never does. */
export async function accessOperation(request: Pick<NodeRequest, 'method' | 'params'>, port: NodeAccessPort, signal: AbortSignal): Promise<NodeOperationResult> {
    if (signal.aborted) throw new NodeProtocolError('cancelled', 'Node request cancelled.');
    if (Buffer.byteLength(JSON.stringify(request)) > NODE_REQUEST_MAX_BYTES) throw new NodeProtocolError('request_limit', 'Node request is too large.');
    const description = port.describe();
    let result: NodeOperationResult;
    if (request.method === 'core.describe') {
      exactKeys(request.params, []); result = description;
    } else {
      const query = queryParams(request.method, request.params);
      if (!description.methods.includes(query.method)) {
        throw new NodeProtocolError('capability_unavailable', 'This Node does not authorize the requested capability.', -32601);
      }
      const data = await port.query(query, signal);
      if (!isRecord(data) || (data.status !== 'success' && data.status !== 'error')) {
        throw new NodeProtocolError('result_invalid', 'Node query returned an invalid observation.', -32603);
      }
      result = { version: 1, method: query.method, principal: description.principal,
        source: { kind: description.kind, nodeId: description.nodeId, synchronized: false }, data };
    }
    if (signal.aborted) throw new NodeProtocolError('cancelled', 'Node request cancelled.');
    if (Buffer.byteLength(JSON.stringify(result)) > NODE_RESULT_MAX_BYTES) {
      throw new NodeProtocolError('result_limit', 'Node query exceeded its bounded result size.', -32603);
    }
    return result;
}

export async function accessRequest(request: NodeRequest, port: NodeAccessPort, signal: AbortSignal) {
  try {
    return { jsonrpc: '2.0' as const, id: request.id, result: await accessOperation(request, port, signal) };
  } catch (error) {
    return { jsonrpc: '2.0' as const, id: request.id, error: protocolError(error) };
  }
}
