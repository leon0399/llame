import { type UnknownRecord } from '@workspace/runtime-safety';
import { NodeProtocolError } from './errors';
import { exactKeys, integer, object, string, uuid } from './validation';

export const QUERY_METHODS = [
  'realm.conversations.search', 'realm.conversations.read',
  'realm.knowledge.search', 'realm.knowledge.read',
] as const;
export type QueryMethod = typeof QUERY_METHODS[number];
export type SearchParams = { query: string; limit: number };
export type ConversationReadParams = { chatId: string; messageSeq: number; offset: number; limit: number };
export type KnowledgeReadParams = { knowledgeSpaceId: string; path: string; offset: number; limit: number };
export type NodeQuery =
  | { method: 'realm.conversations.search' | 'realm.knowledge.search'; params: SearchParams }
  | { method: 'realm.conversations.read'; params: ConversationReadParams }
  | { method: 'realm.knowledge.read'; params: KnowledgeReadParams };

export function isQueryMethod(value: string): value is QueryMethod {
  return QUERY_METHODS.some(method => method === value);
}
export function queryParams(method: string, input: unknown): NodeQuery {
  const params = object(input);
  switch (method) {
    case 'realm.conversations.search':
    case 'realm.knowledge.search': return { method, params: search(params) };
    case 'realm.conversations.read':
      exactKeys(params, ['chatId', 'messageSeq', 'offset', 'limit']);
      return { method, params: { chatId: uuid(params.chatId),
        messageSeq: integer(params.messageSeq, 'message sequence', 1, Number.MAX_SAFE_INTEGER), ...range(params) } };
    case 'realm.knowledge.read':
      exactKeys(params, ['knowledgeSpaceId', 'path', 'offset', 'limit']);
      return { method, params: { knowledgeSpaceId: uuid(params.knowledgeSpaceId), path: relativePath(params.path), ...range(params) } };
    default: throw new NodeProtocolError('method_unavailable', 'This Node method is not supported.', -32601);
  }
}
function search(params: UnknownRecord): SearchParams {
  exactKeys(params, ['query', 'limit']);
  const query = string(params.query, 'query', 200).trim();
  if (!query) throw new NodeProtocolError('invalid_params', 'Query must not be blank.');
  return { query, limit: integer(params.limit === undefined ? 5 : params.limit, 'result limit', 1, 10) };
}
function range(params: UnknownRecord) {
  return { offset: integer(params.offset === undefined ? 0 : params.offset, 'line offset', 0, Number.MAX_SAFE_INTEGER),
    limit: integer(params.limit === undefined ? 100 : params.limit, 'line limit', 1, 2000) };
}
function relativePath(value: unknown): string {
  const path = string(value, 'Knowledge-relative path', 1024);
  if (path.startsWith('/') || path.includes('\\') || /^[A-Za-z]:/u.test(path) ||
      path.split('/').some(part => part === '..' || part === '.' || !part)) {
    throw new NodeProtocolError('invalid_params', 'Expected a Knowledge-relative path, never a host path.');
  }
  return path;
}

export const QUERY_TOOL_IDS: Readonly<Record<QueryMethod, string>> = {
  'realm.conversations.search': 'search_conversations',
  'realm.conversations.read': 'conversation_read',
  'realm.knowledge.search': 'knowledge_search',
  'realm.knowledge.read': 'knowledge_read',
};
