/**
 * The Machine side of a Workspace MCP client set (remote-machines design D6;
 * spec "Workspace MCP servers of a Machine Workspace run from the Machine").
 *
 * The hub never reads `.mcp.json` for a Machine Workspace and never sends a
 * command, a URL, or a header: it asks the Machine which servers the Workspace
 * declares, offers the ones the Machine resolved, and reaches each one over
 * its own relayed `mcp.open` channel. The admission, shadowing, permission,
 * and redaction paths downstream are the local ones, unchanged.
 */

import {
  DEFAULT_REQUEST_BUDGET_MS,
  type MachineRequestEnvelope,
} from '../machines/machine-session';
import { type MachineConnector } from '../machines/machine-connector.service';
import { MachineTransport } from '../machines/machine-mcp-transport';
import { parseMachineLocator } from '../machines/machine-locator';
import { readMcpServersResult } from '../machines/machine-results';
import {
  type JsonValue,
  type McpServerEntry,
} from '@workspace/machine-protocol';
import { type WorkspaceMcpServerConfig } from '@workspace/mcp-workspace';

import {
  McpServerClient,
  type McpMachineRuntimeDefinition,
  type McpMachineServerClientConfig,
} from './mcp-server-client';
import { type McpRuntimeClient } from './mcp-runtime.service';

/**
 * What a Machine Workspace MCP call carries: no Run is executing when a client
 * set starts, so the envelope is identity-free and names only a time budget —
 * the same budget a Machine call without a Run timeout of its own gets.
 */
const MACHINE_MCP_ENVELOPE: MachineRequestEnvelope = Object.freeze({
  budgetMs: DEFAULT_REQUEST_BUDGET_MS,
});

const UNAVAILABLE_ID = 'workspace';
const UNAVAILABLE_REASON = 'Workspace MCP configuration unavailable';

/** The Machine and absolute path one Machine Workspace root names. */
export type MachineWorkspaceTarget = Readonly<{
  machine: string;
  path: string;
}>;

/** One Workspace server as the hub holds it: a local declaration it resolved
 *  itself, or a Machine server it knows only by name. */
export type WorkspaceServerConfig =
  | WorkspaceMcpServerConfig
  | Readonly<{
      id: string;
      state: 'configured';
      definition: McpMachineRuntimeDefinition;
      protectedValues: ReadonlyArray<string>;
    }>;

export type ConfiguredServerConfig = Extract<
  WorkspaceServerConfig,
  { state: 'configured' }
>;

export function unavailableConfig(
  id: string,
  reason: string,
): WorkspaceMcpServerConfig {
  return { id, state: 'unavailable', reason };
}

/** The one entry a client set holds when its configuration could not be read
 *  at all, local or Machine. */
export function unavailableWorkspaceConfig(): WorkspaceMcpServerConfig {
  return unavailableConfig(UNAVAILABLE_ID, UNAVAILABLE_REASON);
}

/**
 * The Machine and absolute path a Workspace root names, when it names one.
 * `resolveWorkspacePath` produced the locator, so a Workspace root is either a
 * local absolute path or a `machine://<name>/<path>` with no selector.
 */
export function machineWorkspaceTarget(
  root: string,
): MachineWorkspaceTarget | undefined {
  const parsed = parseMachineLocator(root);
  return parsed.kind === 'path' && parsed.selector === undefined
    ? { machine: parsed.name, path: parsed.path }
    : undefined;
}

/**
 * Every server a Machine Workspace declares, as the Machine resolved them. A
 * Machine that cannot answer leaves the client set with one unavailable entry,
 * so the Workspace stays usable and the servers return on a later start.
 */
export async function readMachineServerConfigs(
  connector: MachineConnector | undefined,
  target: MachineWorkspaceTarget,
): Promise<ReadonlyArray<WorkspaceServerConfig>> {
  if (connector === undefined || !connector.isConfigured(target.machine)) {
    return [
      unavailableConfig(UNAVAILABLE_ID, 'This Machine is not configured.'),
    ];
  }
  let answer: JsonValue;
  try {
    answer = await connector.request(target.machine, 'mcp.servers', {
      envelope: MACHINE_MCP_ENVELOPE,
      root: target.path,
    });
  } catch {
    return [unavailableWorkspaceConfig()];
  }
  const result = readMcpServersResult(answer);
  if (result === undefined) {
    return [
      unavailableConfig(
        UNAVAILABLE_ID,
        'The Machine answered an unusable MCP configuration',
      ),
    ];
  }
  return result.servers.map((entry) => machineServerConfig(target, entry));
}

/**
 * How one Machine server's client is built: the MCP SDK client over the
 * relayed channel, with the definition's protected values and the channel's
 * liveness read from the transport itself.
 */
export function machineServerClientFactory(
  connector: MachineConnector | undefined,
  target: MachineWorkspaceTarget,
): (config: McpMachineServerClientConfig) => Promise<McpRuntimeClient> {
  return (config) => {
    if (connector === undefined) {
      return Promise.reject(
        new Error('Machine MCP servers need the Machine connector.'),
      );
    }
    const transport = new MachineTransport({
      connector,
      machine: target.machine,
      root: target.path,
      server: config.server,
      envelope: MACHINE_MCP_ENVELOPE,
      signal: config.signal,
      onDiagnostic: config.onDiagnostic,
    });
    return McpServerClient.connectTransport({
      serverId: config.serverId,
      transport,
      protectedValues: () => transport.protectedValues(),
      unavailable: () => transport.lost,
      onDisconnect: config.onDisconnect,
      signal: config.signal,
    });
  };
}

/** One Machine-resolved declaration as the hub's own config shape: the
 *  Machine's diagnostic when it could not resolve it, otherwise the name the
 *  hub sends back to start it. */
function machineServerConfig(
  target: MachineWorkspaceTarget,
  entry: McpServerEntry,
): WorkspaceServerConfig {
  if (entry.state !== 'available' || entry.transport === undefined) {
    return unavailableConfig(
      entry.name,
      entry.diagnostic ?? "the server's transport is unknown",
    );
  }
  const definition: McpMachineRuntimeDefinition = Object.freeze({
    transport: 'machine',
    machine: target.machine,
    root: target.path,
    server: entry.name,
    kind: entry.transport,
  });
  return {
    id: entry.name,
    state: 'configured',
    definition,
    protectedValues: [],
  };
}
