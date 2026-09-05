import { type UnknownRecord } from '@workspace/runtime-safety';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { keys, record, text } from './validation';
import { CliError } from './errors';

/** Local slice of the Node protocol family. Not MCP, ACP, or hosted REST. */
export const NODE_PROTOCOL_VERSION = 1;
export const MAX_REQUEST_BYTES = 1_048_576;
export const MAX_RESPONSE_BYTES = 12_582_912;
export const MAX_PENDING_REQUESTS = 16;
export const MAX_CONNECTION_REQUESTS = 4096;

export interface NodeRequest {
  readonly jsonrpc: '2.0';
  readonly id: string;
  readonly method: string;
  readonly params: UnknownRecord;
}

export interface NodeHello {
  readonly version: 1;
  readonly nodeId: string;
  readonly principal: 'local-owner';
  readonly transport: 'stdio' | 'unix';
  readonly modules: { readonly core: 1; readonly realm: 1; readonly execution: 1; readonly admin: 1 };
  readonly capabilities: readonly string[];
  readonly configIdentity: string;
  readonly workspaceIdentity: string | null;
  readonly synchronization: false;
}

export function nodeRequest(value: unknown): NodeRequest {
  const input = record(value, 'Node request');
  keys(input, ['jsonrpc', 'id', 'method', 'params'], 'Node request');
  if (input.jsonrpc !== '2.0') throw new CliError('protocol', 'Expected JSON-RPC 2.0.');
  return { jsonrpc: '2.0', id: text(input.id, 'request id', 100),
    method: text(input.method, 'method', 100), params: record(input.params ?? {}, 'params') };
}

export function pathIdentity(path: string): string {
  return createHash('sha256').update(resolve(path)).digest('hex');
}
