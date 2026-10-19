import {
  isStdio,
  readWorkspaceMcpConfig,
  type McpRuntimeServerDefinition,
  type WorkspaceMcpServerConfig,
} from "@workspace/mcp-workspace";
import {
  MCP_OPEN_METHOD,
  MCP_SERVERS_METHOD,
  type McpOpenResult,
  type McpServerEntry,
  type McpServersResult,
  type SerializableValue,
} from "@workspace/machine-protocol";
import { invalidParams } from "./errors";
import { machineEnvironment } from "./env";
import type { OperationContext } from "./dispatch-types";
import { McpRelay } from "./mcp-relay";
import { paramRecord, requireString } from "./params";

/**
 * The Workspace root the hub named, guarded like any other Machine address:
 * a root outside the registered ones is refused before any file is read, and
 * the refusal is identical whether or not the directory exists.
 */
async function workspaceRoot(
  literal: string,
  method: string,
  context: OperationContext,
): Promise<string> {
  const guarded = await context.guard.resolvePath(literal);
  if (guarded.kind !== "directory")
    throw invalidParams(method, "the Workspace root is not a directory");
  return guarded.path;
}

/** One declaration, as the hub sees it: enough to offer or withhold a server. */
function entryFor(config: WorkspaceMcpServerConfig): McpServerEntry {
  if (config.state === "unavailable")
    return { name: config.id, state: "unavailable", diagnostic: config.reason };
  return {
    name: config.id,
    transport: isStdio(config.definition) ? "stdio" : "http",
    state: "available",
  };
}

/**
 * Every Workspace MCP server declared for `root`, resolved here: interpolation
 * reads this Machine's environment and filesystem, so a value only the hub
 * defines leaves that server unavailable here and never travels to the hub.
 */
export async function serversOperation(
  params: SerializableValue,
  context: OperationContext,
): Promise<McpServersResult> {
  const source = paramRecord(params, MCP_SERVERS_METHOD);
  const root = await workspaceRoot(
    requireString(source, "root", MCP_SERVERS_METHOD),
    MCP_SERVERS_METHOD,
    context,
  );
  const configs = await readWorkspaceMcpConfig(root, machineEnvironment());
  return { servers: configs.map(entryFor) };
}

/** The declaration to start: re-read from disk, never cached from discovery. */
async function startableDefinition(
  root: string,
  server: string,
): Promise<
  Readonly<{
    definition: McpRuntimeServerDefinition;
    protectedValues: ReadonlyArray<string>;
  }>
> {
  const configs = await readWorkspaceMcpConfig(root, machineEnvironment());
  const config = configs.find((entry) => entry.id === server);
  if (config === undefined)
    throw invalidParams(
      MCP_OPEN_METHOD,
      `this Workspace declares no server named ${server}`,
    );
  if (config.state === "unavailable")
    throw invalidParams(
      MCP_OPEN_METHOD,
      `the server named ${server} is unavailable: ${config.reason}`,
    );
  return {
    definition: config.definition,
    protectedValues: config.protectedValues,
  };
}

/**
 * Starts one Workspace MCP server of this Machine and relays its messages
 * until the hub cancels the stream, the session ends, or the server dies. The
 * declaration is read again here, so a config edited between discovery and
 * start is started as it now stands — and the hub redacts against the
 * protected values of the definition actually started.
 */
export async function openOperation(
  params: SerializableValue,
  context: OperationContext,
): Promise<McpOpenResult> {
  const source = paramRecord(params, MCP_OPEN_METHOD);
  const root = await workspaceRoot(
    requireString(source, "root", MCP_OPEN_METHOD),
    MCP_OPEN_METHOD,
    context,
  );
  const server = requireString(source, "server", MCP_OPEN_METHOD);
  const startable = await startableDefinition(root, server);
  const relay = new McpRelay({
    name: server,
    definition: startable.definition,
    protectedValues: startable.protectedValues,
    context,
  });
  await relay.start();
  // The session is over only once every server it started is gone, so the
  // session end waits on this relay exactly as it waits on a `bash` group.
  void context.processes.track(relay.done);
  return { protectedValues: [...startable.protectedValues] };
}
