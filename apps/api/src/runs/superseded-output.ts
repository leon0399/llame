import { payloadNumber, type RunEventLike } from './run-event-chunks';

export type SupersededModelOutput = { fromSequence: number; step: number };

export type SupersededWindow = { readonly from: number; readonly to: number };

export function supersededWindow(
  event: RunEventLike,
): SupersededWindow | undefined {
  if (event.eventType !== 'model.superseded') return undefined;
  const from = payloadNumber(event.payload, 'fromSequence');
  const step = payloadNumber(event.payload, 'step');
  const to = event.sequence;

  if (
    from === undefined ||
    step === undefined ||
    to === undefined ||
    !Number.isSafeInteger(from) ||
    from <= 0 ||
    !Number.isSafeInteger(step) ||
    step < 0 ||
    !Number.isSafeInteger(to) ||
    to <= 0 ||
    from > to
  )
    return undefined;

  return { from, to };
}

export function supersededWindows(
  events: ReadonlyArray<RunEventLike>,
): Array<SupersededWindow> {
  const windows: Array<SupersededWindow> = [];

  for (const event of events) {
    const window = supersededWindow(event);

    if (window !== undefined) windows.push(window);
  }

  windows.sort((left, right) => left.from - right.from || left.to - right.to);
  const merged: Array<SupersededWindow> = [];

  for (const window of windows) {
    const previous = merged.at(-1);

    if (previous !== undefined && window.from <= previous.to) {
      merged[merged.length - 1] = {
        from: previous.from,
        to: Math.max(previous.to, window.to),
      };
    } else {
      merged.push(window);
    }
  }

  return merged;
}

export function hasSupersededOutput(
  events: ReadonlyArray<RunEventLike>,
): boolean {
  return events.some((event) => supersededWindow(event) !== undefined);
}
