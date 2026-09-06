import {
  isRecord,
  isString,
  type UnknownRecord,
} from "@workspace/runtime-safety";
import { NodeProtocolError } from "./errors";
import { exactKeys, integer, string, uuid } from "./validation";

export const QUERY_METHODS = [
  "realm.conversations.search",
  "realm.conversations.read",
  "realm.knowledge.search",
  "realm.knowledge.read",
] as const;
export type QueryMethod = (typeof QUERY_METHODS)[number];
export type SearchParams = { query: string; limit: number };
export type ConversationReadParams = {
  chatId: string;
  messageSeq: number;
  offset: number;
  limit: number;
};
export type KnowledgeReadParams = {
  knowledgeSpaceId: string;
  path: string;
  offset: number;
  limit: number;
};
export type NodeQuery =
  | {
      method: "realm.conversations.search" | "realm.knowledge.search";
      params: SearchParams;
    }
  | { method: "realm.conversations.read"; params: ConversationReadParams }
  | { method: "realm.knowledge.read"; params: KnowledgeReadParams };

export function isQueryMethod(value: string): value is QueryMethod {
  return QUERY_METHODS.some((method) => method === value);
}
export function queryParams(method: string, input: unknown): NodeQuery {
  if (!isRecord(input))
    throw new NodeProtocolError("invalid_params", "Expected an object.");
  switch (method) {
    case "realm.conversations.search":
    case "realm.knowledge.search":
      return { method, params: search(input) };
    case "realm.conversations.read":
      exactKeys(input, ["chatId", "messageSeq", "offset", "limit"]);
      return {
        method,
        params: {
          chatId: uuid(input.chatId),
          messageSeq: integer(
            input.messageSeq,
            "message sequence",
            1,
            Number.MAX_SAFE_INTEGER,
          ),
          ...range(input),
        },
      };
    case "realm.knowledge.read":
      exactKeys(input, ["knowledgeSpaceId", "path", "offset", "limit"]);
      return {
        method,
        params: {
          knowledgeSpaceId: uuid(input.knowledgeSpaceId),
          path: relativePath(input.path),
          ...range(input),
        },
      };
    default:
      throw new NodeProtocolError(
        "method_unavailable",
        "This Node method is not supported.",
        -32_601,
      );
  }
}
function search(params: UnknownRecord): SearchParams {
  exactKeys(params, ["query", "limit"]);
  const query = string(params.query, "query", 200).trim();
  if (!query)
    throw new NodeProtocolError("invalid_params", "Query must not be blank.");
  return {
    query,
    limit: integer(
      params.limit === undefined ? 5 : params.limit,
      "result limit",
      1,
      10,
    ),
  };
}
function range(params: UnknownRecord) {
  return {
    offset: integer(
      params.offset === undefined ? 0 : params.offset,
      "line offset",
      0,
      Number.MAX_SAFE_INTEGER,
    ),
    limit: integer(
      params.limit === undefined ? 100 : params.limit,
      "line limit",
      1,
      2000,
    ),
  };
}
function relativePath(value: unknown): string {
  if (!isString(value))
    throw new NodeProtocolError(
      "invalid_params",
      "Invalid Knowledge-relative path.",
    );
  const path = string(value, "Knowledge-relative path", 1024);
  if (
    path.startsWith("/") ||
    path.includes("\\") ||
    /^[A-Za-z]:/u.test(path) ||
    path.split("/").some((part) => part === ".." || part === "." || !part)
  ) {
    throw new NodeProtocolError(
      "invalid_params",
      "Expected a Knowledge-relative path, never a host path.",
    );
  }
  return path;
}

export const QUERY_TOOL_IDS = {
  "realm.conversations.search": "search_conversations",
  "realm.conversations.read": "conversation_read",
  "realm.knowledge.search": "knowledge_search",
  "realm.knowledge.read": "knowledge_read",
} as const satisfies Record<QueryMethod, string>;
