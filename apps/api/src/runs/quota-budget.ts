import { isNumber, isRecord } from '@workspace/runtime-safety';
import type { RunEvent } from '../db/schema/chats';

/** Input is the Run's sequence-ordered event stream. */
export function quotaWaitElapsedMs(events: ReadonlyArray<RunEvent>): number {
  let elapsedMs = 0;
  const suspensions = new Map<number, RunEvent>();

  for (const event of events) {
    const payload = event.payload;

    if (!isRecord(payload) || payload['kind'] !== 'quota') continue;
    const generation = payload['generation'];

    if (
      !isNumber(generation) ||
      !Number.isSafeInteger(generation) ||
      generation < 1
    )
      continue;

    if (event.eventType === 'run.suspended') {
      suspensions.set(generation, event);
      continue;
    }

    if (event.eventType !== 'run.resumed') continue;
    const suspended = suspensions.get(generation);

    if (suspended === undefined || suspended.sequence >= event.sequence)
      continue;
    elapsedMs += Math.max(
      0,
      event.createdAt.getTime() - suspended.createdAt.getTime(),
    );
    suspensions.delete(generation);
  }

  return elapsedMs;
}
