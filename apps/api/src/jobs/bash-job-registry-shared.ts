import { LostCause } from '@workspace/machine-protocol';

export function lostCause(cause: LostCause): string {
  if (cause === LostCause.MACHINE_REBOOTED) return 'machine_rebooted';

  if (cause === LostCause.CANCEL_UNPROVED) return 'stop_unproved';

  return 'daemon_restarted';
}
