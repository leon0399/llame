import { Code, ConnectError } from '@connectrpc/connect';
import {
  ErrorDetailSchema,
  ErrorReason,
  MachineProtocolError,
  isMachineErrorCode,
} from '@workspace/machine-protocol';

const ERROR_CODES: Partial<Record<ErrorReason, string>> = {
  [ErrorReason.PATH_NOT_REGISTERED]: 'path_not_registered',
  [ErrorReason.INVALID_ARGUMENT]: 'invalid_argument',
  [ErrorReason.JOB_LIMIT]: 'machine_job_limit',
  [ErrorReason.JOB_NOT_FOUND]: 'machine_job_not_found',
  [ErrorReason.JOB_RUNNING]: 'machine_job_running',
};

export function mapMachineRefusal(
  machine: string,
  error: unknown,
  sent = false,
): Error {
  if (!(error instanceof ConnectError))
    return error instanceof Error ? error : new Error(String(error));

  const detail = error.findDetails(ErrorDetailSchema)[0];
  const code = detail === undefined ? undefined : ERROR_CODES[detail.reason];

  if (code !== undefined && isMachineErrorCode(code))
    return new MachineProtocolError(code, error.rawMessage);

  if (error.code === Code.Unimplemented)
    return new MachineUpdateRequiredError(machine, 'requested operation');

  if (error.code === Code.DeadlineExceeded)
    return new MachineProtocolError(
      'budget_exhausted',
      'Machine request budget exhausted.',
    );

  return new MachineUnavailableError(
    machine,
    'session_lost',
    sent,
    error.rawMessage,
  );
}

import type { MachineFailureReason } from './machines-status';

export class MachineUnavailableError extends Error {
  constructor(
    readonly machine: string,
    readonly reason: MachineFailureReason,
    readonly sent: boolean,
    message: string,
  ) {
    super(message);
    this.name = 'MachineUnavailableError';
  }
}

export class MachineIdentityMismatchError extends MachineUnavailableError {
  constructor(machine: string) {
    super(
      machine,
      'identity_mismatch',
      false,
      'The Machine answered with a different identity than the one bound to its name.',
    );
    this.name = 'MachineIdentityMismatchError';
  }
}

export class MachineUpdateRequiredError extends Error {
  constructor(machine: string, method: string) {
    super(
      `The llame-machine daemon on ${machine} does not implement ${method}. Update the daemon on that Machine.`,
    );
    this.name = 'MachineUpdateRequiredError';
  }
}
