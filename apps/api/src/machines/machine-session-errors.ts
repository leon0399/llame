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
