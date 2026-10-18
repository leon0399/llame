import {
  MCP_OPEN_METHOD,
  MCP_SERVERS_METHOD,
  PROC_BASH_METHOD,
  ROOTS_LIST_METHOD,
  type JsonValue,
  type SerializableValue,
} from "@workspace/machine-protocol";
import { MachineRequestError } from "./errors";
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
import { bashOperation } from "./proc";

function rootsOperation(
  _params: SerializableValue,
  context: OperationContext,
): Promise<{ readonly roots: ReadonlyArray<string> }> {
  return Promise.resolve({ roots: [...context.roots] });
}

/** Registered now, served by the Workspace MCP layer later. */
function notImplemented(): Promise<never> {
  return Promise.reject(
    new MachineRequestError("internal", "not implemented yet"),
  );
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
  [MCP_SERVERS_METHOD]: notImplemented,
  [MCP_OPEN_METHOD]: notImplemented,
};

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
