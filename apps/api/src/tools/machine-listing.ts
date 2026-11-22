/**
 * The `machine://` listing: every configured Machine with its derived status,
 * plus the header-and-lines envelope every Machine listing is built from.
 * The status read model is owner-scoped and never names an SSH route, a jump
 * host, an instance id, or a kernel; a context without it still lists the
 * names, without a status.
 */

import { type MachineConnector } from '../machines/machine-connector.service';
import { machinePrefix, MACHINE_SCHEME } from '../machines/machine-locator';
import { type MachineStatusView } from '../machines/machines-status';
import { type ToolContext, type ToolResult } from './types';

/** The configured Machines and their derived status. */
export async function configuredMachines(
  context: ToolContext,
  connector: MachineConnector,
): Promise<ToolResult> {
  const names = connector.names();
  const statuses = await context.machineStatus?.list(context.userId);

  const byName = new Map(
    (statuses ?? []).map((status) => [status.name, status]),
  );

  const lines = names.map((name) => {
    const status = byName.get(name);

    if (status === undefined) return `- ${machinePrefix(name)}`;

    return `- ${machinePrefix(name)} (${machineStatusDetail(status)})`;
  });

  return listingResult(
    `${MACHINE_SCHEME}://`,
    lines.length === 0 ? ['(no Machines configured)'] : lines,
  );
}

/**
 * One Machine's parenthesized status in the listing: its state, the reason it
 * is offline, and the OS and architecture once a handshake reported them. An
 * old daemon's version mismatch reads "update required", the instruction the
 * operator needs, rather than the wire's reason.
 */
function machineStatusDetail(status: MachineStatusView): string {
  const platform =
    status.facts === null ? '' : `, ${status.facts.os}/${status.facts.arch}`;

  if (status.status === 'online') return `online${platform}`;

  if (status.failureReason === null) return `offline${platform}`;

  const reason =
    status.failureReason === 'incompatible_version'
      ? 'update required'
      : status.failureReason;

  return `offline, ${reason}${platform}`;
}

/** The one result shape both listing forms report: a header and its lines. */
export function listingResult(
  path: string,
  lines: ReadonlyArray<string>,
): ToolResult {
  return {
    status: 'success',
    kind: 'directory',
    path,
    content: lines.join('\n'),
    truncated: false,
  };
}
