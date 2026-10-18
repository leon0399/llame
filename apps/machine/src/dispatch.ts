import {
  MCP_OPEN_METHOD,
  MCP_SERVERS_METHOD,
  PROC_BASH_METHOD,
  ROOTS_LIST_METHOD,
  type JsonValue,
  type SerializableValue,
} from "@workspace/machine-protocol";
import type {
  Operation,
  OperationContext,
  OperationTable,
} from "./dispatch-types";
import {
  bytesOperation,
  editOperation,
  listOperation,
  readOperation,
  statOperation,
  writeOperation,
} from "./files";
import { openOperation, serversOperation } from "./mcp";
import { bashOperation } from "./proc";

function rootsOperation(
  _params: SerializableValue,
  context: OperationContext,
): Promise<{ readonly roots: ReadonlyArray<string> }> {
  return Promise.resolve({ roots: [...context.roots] });
}

const OPERATIONS: OperationTable = {
  [ROOTS_LIST_METHOD]: rootsOperation,
  "fs.stat": statOperation,
  "fs.list": listOperation,
  "fs.read": readOperation,
  "fs.edit": editOperation,
  "fs.write": writeOperation,
  "fs.bytes": bytesOperation,
  [PROC_BASH_METHOD]: bashOperation,
  [MCP_SERVERS_METHOD]: serversOperation,
  [MCP_OPEN_METHOD]: openOperation,
};

const STREAM_KEEPING_OPERATIONS: Readonly<Partial<Record<Operation, true>>> = {
  [MCP_OPEN_METHOD]: true,
};

/**
 * Whether the operation's stream outlives its answer: `mcp.open` relays a
 * running server until that server dies or the hub cancels, so it closes its
 * own stream and the session must not close it on the answer.
 */
export function keepsStreamOpen(method: Operation): boolean {
  return STREAM_KEEPING_OPERATIONS[method] === true;
}

export function isOperation(method: string): method is Operation {
  return Object.hasOwn(OPERATIONS, method);
}

export function executeOperation(
  method: Operation,
  params: SerializableValue,
  context: OperationContext,
): Promise<JsonValue> {
  return OPERATIONS[method](params, context);
}
