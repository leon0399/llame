import { MachineProtocolError } from '@workspace/machine-protocol';

import {
  MachineIdentityMismatchError,
  MachineUnavailableError,
  MachineUpdateRequiredError,
} from '../machines/machine-session-errors';
import {
  machineIdentityMismatchResult,
  machineProtocolFailureResult,
  machineUnavailableResult,
  machineUnusableResult,
  type MachineFailureResult,
} from './machine-call';

/** The Machine failure vocabulary, as `read` maps it, plus the missing method. */
export function machineGrepFailure(
  name: string,
  error: unknown,
): MachineFailureResult {
  if (error instanceof MachineIdentityMismatchError)
    return machineIdentityMismatchResult(name);

  if (error instanceof MachineUnavailableError)
    return machineUnavailableResult(name, error.reason);

  if (error instanceof MachineUpdateRequiredError)
    return machineUnusableResult(name);

  if (error instanceof MachineProtocolError) {
    return error.code === 'internal'
      ? machineUnusableResult(name)
      : machineProtocolFailureResult(name, error);
  }

  throw error;
}
