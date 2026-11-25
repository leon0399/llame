/**
 * The in-process host guard (design D8, remote-machines "In-process host
 * operations need a verified host Machine daemon").
 *
 * A family that still runs in process serves this process's own filesystem, so
 * before its first operation the process completes an identity-checked
 * handshake with its own daemon child. Without it, a worker that set
 * `machines.local` to another computer's name would run that Machine's
 * operations locally with no check. A failed handshake is the tool result:
 * the operation never runs in process.
 */

import {
  MachineIdentityMismatchError,
  MachineUnavailableError,
} from '../machines/machine-session-errors';
import {
  machineIdentityMismatchResult,
  machineUnavailableResult,
} from './machine-call';
import { type ToolContext, type ToolResult } from './types';

/** The refusal every in-process family shares when no Machine is configured. */
export const NO_LOCAL_MACHINE_MESSAGE =
  'No local Machine is configured: set machines.local to the Machine this ' +
  'process hosts before an operation runs in process.';

/**
 * Undefined when the local daemon verified; otherwise the tool failure to
 * return — `machine_unavailable` or `machine_identity_mismatch` — and the
 * operation must not run in process.
 */
export async function verifyLocalMachine(
  context: ToolContext,
): Promise<ToolResult | undefined> {
  const name = context.localMachine;
  const connector = context.machines;

  if (name === undefined || connector === undefined) {
    return {
      ...machineUnavailableResult(name ?? 'local'),
      message: NO_LOCAL_MACHINE_MESSAGE,
    };
  }

  try {
    await connector.verifyLocal();

    return undefined;
  } catch (error) {
    // The mismatch subclass is checked first: it is its own operator-facing
    // outcome, and nothing was ever sent.
    if (error instanceof MachineIdentityMismatchError)
      return machineIdentityMismatchResult(name);

    if (error instanceof MachineUnavailableError)
      return machineUnavailableResult(name, error.reason);

    throw error;
  }
}
