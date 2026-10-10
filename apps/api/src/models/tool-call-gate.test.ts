import { tool, type ToolSet } from 'ai';
import { z } from 'zod';

import { createToolCallGate, gateToolExecution } from './tool-call-gate';

const OPTIONS = { toolCallId: 'call-1', messages: [] };

function echo(log: Array<string>) {
  return tool({
    inputSchema: z.strictObject({ value: z.string() }),
    execute: ({ value }) => {
      log.push(`execute:${value}`);
      return value;
    },
  });
}

describe('gateToolExecution', () => {
  it('holds a tool added after the record was handed out until its call is reached', async () => {
    const log: Array<string> = [];
    const gate = createToolCallGate();
    gate.attach();
    const record: ToolSet = gateToolExecution({}, gate);
    // The run adds tools mid-request through the record it was given.
    record['echo'] = echo(log);

    const execution: unknown = record['echo']?.execute?.(
      { value: 'x' },
      OPTIONS,
    );
    await Promise.resolve();
    expect(log).toEqual([]);

    gate.reach('call-1');
    await expect(execution).resolves.toBe('x');
    expect(log).toEqual(['execute:x']);
  });

  it('runs every call at once when no in-order consumer attached', async () => {
    const log: Array<string> = [];
    const record = gateToolExecution({ echo: echo(log) }, createToolCallGate());

    await expect(
      record['echo']?.execute?.({ value: 'x' }, OPTIONS),
    ).resolves.toBe('x');
  });
});

describe('createToolCallGate', () => {
  it('runs a deferred report when the consumer reaches the call, not before', () => {
    const gate = createToolCallGate();
    gate.attach();
    const report = vi.fn();

    gate.whenReached('call-1', report);
    expect(report).not.toHaveBeenCalled();

    gate.reach('call-1');
    expect(report).toHaveBeenCalledOnce();
  });
});
