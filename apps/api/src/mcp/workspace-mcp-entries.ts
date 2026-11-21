/**
 * The entries one Workspace's MCP configuration resolves to: the configured
 * servers (as the runtime needs them), and the state each reports once the
 * runtime has answered. A server whose id collides with the operator's own
 * catalog case-insensitively is not a Workspace entry: two ids that differ only
 * in case would be one tool name.
 */

import {
  type ConfiguredServerConfig,
  type WorkspaceServerConfig,
} from './machine-workspace-servers';
import {
  type McpRuntimeDefinition,
  type McpRuntimeServerState,
} from './mcp-runtime.service';

/** One server's report, before the runtime has spoken for it. */
export type WorkspaceMcpServerState = Readonly<{
  id: string;
  state: 'available' | 'unavailable';
  reason?: string;
}>;

/** One configured server as the runtime starts it. */
export function runtimeDefinition(
  config: ConfiguredServerConfig,
): McpRuntimeDefinition {
  return { ...config.definition, protectedValues: config.protectedValues };
}

/** The Workspace's configured servers, minus the operator's id collisions. */
export function configuredEntries(
  configs: ReadonlyArray<WorkspaceServerConfig>,
  operatorIds: ReadonlyArray<string>,
): ReadonlyArray<ConfiguredServerConfig> {
  return configs.filter(
    (config): config is ConfiguredServerConfig =>
      config.state === 'configured' &&
      !isCaseOnlyCollision(config.id, operatorIds),
  );
}

/** Every configured entry, keyed by id, as the runtime starts them. */
export function runtimeDefinitions(
  configs: ReadonlyArray<ConfiguredServerConfig>,
): Readonly<Record<string, McpRuntimeDefinition>> {
  return Object.freeze(
    Object.fromEntries(
      configs.map((config) => [config.id, runtimeDefinition(config)]),
    ),
  );
}

/** One server's state after the runtime answered, or the connecting default. */
export function runtimeState(
  id: string,
  states: ReadonlyArray<McpRuntimeServerState>,
): WorkspaceMcpServerState {
  const state = states.find((entry) => entry.serverId === id);

  if (state === undefined) return unavailable(id, 'source_connecting');

  return state.state === 'available'
    ? { id, state: 'available' }
    : unavailable(id, state.reason ?? 'source_disconnected');
}

/** One server reported as not started, with the reason it gave. */
export function unavailable(
  id: string,
  reason: string,
): WorkspaceMcpServerState {
  return { id, state: 'unavailable', reason };
}

export function isCaseOnlyCollision(
  id: string,
  operatorIds: ReadonlyArray<string>,
): boolean {
  return operatorIds.some(
    (operatorId) =>
      operatorId !== id && asciiFold(operatorId) === asciiFold(id),
  );
}

function asciiFold(value: string): string {
  return value.replaceAll(/[A-Z]/gu, (letter) => letter.toLowerCase());
}
