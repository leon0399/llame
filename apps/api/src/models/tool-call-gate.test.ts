import { InvalidToolInputError, NoSuchToolError, tool, type ToolSet } from 'ai';
import { z } from 'zod';

import { asDouble } from '../testing/support';
import {
  createToolCallGate,
  gateToolExecution,
  refuseUnavailableToolCalls,
} from './tool-call-gate';

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

describe('refuseUnavailableToolCalls', () => {
  it('reports the SDK’s own error text and input for an unknown tool', async () => {
    const report = vi.fn();
    const repair = refuseUnavailableToolCalls(report, createToolCallGate());

    const error = new NoSuchToolError({
      toolName: 'fetch_page',
      availableTools: ['read'],
    });

    const input = '{"url":"https://example.test/"}';

    await expect(
      repair(
        asDouble<Parameters<typeof repair>[0]>({
          toolCall: {
            type: 'tool-call',
            toolCallId: 'call-1',
            toolName: 'fetch_page',
            input,
          },
          error,
        }),
      ),
    ).resolves.toBeNull();

    expect(report).toHaveBeenCalledWith({
      toolCallId: 'call-1',
      toolName: 'fetch_page',
      input: { url: 'https://example.test/' },
      reason: 'not_available',
      sdkRefusal: {
        // The text the SDK itself renders, not llame's owner-facing message.
        errorText: error.message,
        input: { url: 'https://example.test/' },
      },
    });
    expect(error.message).toContain('Available tools: read');
  });

  it('drops a prototype key exactly as the SDK’s own parser does', async () => {
    const report = vi.fn();
    const repair = refuseUnavailableToolCalls(report, createToolCallGate());
    const error = new NoSuchToolError({ toolName: 'fetch_page' });

    // `ai` parses the refused call's input with `secureJsonParse`, which
    // throws on an own `__proto__` key; the SDK then keeps the raw string and
    // its model-message conversion turns that into `{}`, so replay must too.
    await repair(
      asDouble<Parameters<typeof repair>[0]>({
        toolCall: {
          type: 'tool-call',
          toolCallId: 'call-3',
          toolName: 'fetch_page',
          input: '{"__proto__":{"polluted":true}}',
        },
        error,
      }),
    );

    expect(report).toHaveBeenCalledWith(
      expect.objectContaining({
        toolCallId: 'call-3',
        sdkRefusal: { errorText: error.message, input: {} },
      }),
    );
    expect(Object.prototype).not.toHaveProperty('polluted');
  });

  it('records an unparsable input as the empty object the SDK sends', async () => {
    const report = vi.fn();
    const repair = refuseUnavailableToolCalls(report, createToolCallGate());

    const error = new InvalidToolInputError({
      toolName: 'read',
      toolInput: 'not valid json{{{',
      cause: new SyntaxError('Unexpected token'),
    });

    await repair(
      asDouble<Parameters<typeof repair>[0]>({
        toolCall: {
          type: 'tool-call',
          toolCallId: 'call-2',
          toolName: 'read',
          input: 'not valid json{{{',
        },
        error,
      }),
    );

    expect(report).toHaveBeenCalledWith(
      expect.objectContaining({
        toolCallId: 'call-2',
        reason: 'invalid_input',
        // `ai` renders `{}` for an invalid call whose input is not an object,
        // so replay sends the same form (design D3, proposal A8).
        sdkRefusal: { errorText: error.message, input: {} },
      }),
    );
  });
});
