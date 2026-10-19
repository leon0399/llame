/**
 * Machine-domain queue contracts (remote-machines D9). Everything queue-facing
 * for Machines lives here: the minute probe is the background retry behind the
 * Machines list, and its payload is an empty marker — the work is "contact every
 * configured Machine", identical whatever triggered the tick.
 */

import { machinesProbeChannel } from '../queue/generated/queue-protocol';
import { defineQueue } from '../queue/queue';

/** The probe carries no data; the consumer derives its work from configuration. */
export type MachinesProbeJob = Record<string, never>;

export const MACHINES_PROBE_QUEUE = defineQueue<MachinesProbeJob>({
  name: machinesProbeChannel.address,
  // `stately` so a probe still running when the next tick fires does not stack:
  // one queued + one running probe is all the freshness window needs.
  options: machinesProbeChannel.options,
  parse: () => ({}),
});

/**
 * Every minute. The online window is 150 seconds, so this leaves room for two
 * missed ticks before a reachable Machine would read offline.
 */
export const MACHINES_PROBE_CRON = '* * * * *';
