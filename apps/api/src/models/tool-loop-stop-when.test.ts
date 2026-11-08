import { type StopCondition, type ToolSet } from 'ai';

import { toolLoopStopWhen, type ToolLoopStopWhen } from './tool-loop-stop-when';

/** Whether any condition of the `stopWhen` value stops after `stepCount` steps. */
async function stops(
  stopWhen: ToolLoopStopWhen,
  stepCount: number,
): Promise<boolean> {
  const conditions: Array<StopCondition<ToolSet>> = Array.isArray(stopWhen)
    ? stopWhen
    : stopWhen === undefined
      ? []
      : [stopWhen];
  const steps = Array.from({ length: stepCount }, () => ({}));
  const verdicts = await Promise.all(
    conditions.map((condition) =>
      // SAFETY: the conditions under test read only `steps.length`.
      // eslint-disable-next-line typescript/no-unsafe-type-assertion -- see SAFETY above.
      Promise.resolve(condition({ steps } as never)),
    ),
  );
  return verdicts.some(Boolean);
}

describe('toolLoopStopWhen', () => {
  it('stops one step past the configured cap, which is the forced answer', async () => {
    const stopWhen = toolLoopStopWhen({ maxSteps: 2 });

    expect(await stops(stopWhen, 2)).toBe(false);
    expect(await stops(stopWhen, 3)).toBe(true);
  });

  it('never stops on a missing or null cap', async () => {
    expect(await stops(toolLoopStopWhen({}), 50)).toBe(false);
    expect(await stops(toolLoopStopWhen({ maxSteps: null }), 50)).toBe(false);
  });

  it('also stops when the extra condition says so, under any cap', async () => {
    let verdict = false;
    const extra = () => Promise.resolve(verdict);
    const capped = toolLoopStopWhen({ maxSteps: 8, stopWhenExtra: extra });
    const uncapped = toolLoopStopWhen({ stopWhenExtra: extra });

    expect(await stops(capped, 1)).toBe(false);
    expect(await stops(uncapped, 1)).toBe(false);
    verdict = true;
    expect(await stops(capped, 1)).toBe(true);
    expect(await stops(uncapped, 1)).toBe(true);
  });

  it('keeps the cap when an extra condition is present', async () => {
    const stopWhen = toolLoopStopWhen({
      maxSteps: 1,
      stopWhenExtra: () => Promise.resolve(false),
    });

    expect(await stops(stopWhen, 2)).toBe(true);
  });
});
