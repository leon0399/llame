import { PROVIDER_ZERO_USAGE, scriptedStepParts } from './scripted-model-step';

describe('scriptedStepParts', () => {
  it('expands reasoning, text, and calls in wire order with their metadata', () => {
    const metadata = { test: { signature: 'sig-0' } };
    const parts = scriptedStepParts([
      {
        type: 'reasoning',
        id: 'r0',
        text: 'think',
        providerMetadata: metadata,
      },
      { type: 'text', id: 't0', text: 'before' },
      {
        type: 'tool-call',
        toolCallId: 'call-one',
        toolName: 'record',
        input: { value: 'one' },
        providerMetadata: metadata,
      },
      {
        type: 'tool-call',
        toolCallId: 'call-two',
        toolName: 'record',
        input: '{"value":',
      },
      { type: 'text', id: 't1', text: 'after' },
    ]);

    expect(parts).toEqual([
      { type: 'reasoning-start', id: 'r0', providerMetadata: metadata },
      {
        type: 'reasoning-delta',
        id: 'r0',
        delta: 'think',
        providerMetadata: metadata,
      },
      { type: 'reasoning-end', id: 'r0', providerMetadata: metadata },
      { type: 'text-start', id: 't0' },
      { type: 'text-delta', id: 't0', delta: 'before' },
      { type: 'text-end', id: 't0' },
      {
        type: 'tool-call',
        toolCallId: 'call-one',
        toolName: 'record',
        input: '{"value":"one"}',
        providerMetadata: metadata,
      },
      {
        type: 'tool-call',
        toolCallId: 'call-two',
        toolName: 'record',
        input: '{"value":',
      },
      { type: 'text-start', id: 't1' },
      { type: 'text-delta', id: 't1', delta: 'after' },
      { type: 'text-end', id: 't1' },
      {
        type: 'finish',
        finishReason: { unified: 'tool-calls', raw: undefined },
        usage: PROVIDER_ZERO_USAGE,
      },
    ]);
  });

  it('omits empty reasoning and text deltas but keeps their parts', () => {
    const parts = scriptedStepParts([
      { type: 'reasoning', id: 'r0' },
      { type: 'text', id: 't0', text: '' },
    ]);

    expect(parts).toEqual([
      { type: 'reasoning-start', id: 'r0' },
      { type: 'reasoning-end', id: 'r0' },
      { type: 'text-start', id: 't0' },
      { type: 'text-end', id: 't0' },
      {
        type: 'finish',
        finishReason: { unified: 'stop', raw: undefined },
        usage: PROVIDER_ZERO_USAGE,
      },
    ]);
  });

  it('ends at the error part without a finish', () => {
    const parts = scriptedStepParts([
      { type: 'reasoning', id: 'r0', text: 'doomed' },
      { type: 'error', message: 'provider dropped' },
    ]);

    expect(parts.at(-1)).toEqual({
      type: 'error',
      error: new Error('provider dropped'),
    });
    expect(parts.some((part) => part.type === 'finish')).toBe(false);
  });

  it('defaults the error message when the script names none', () => {
    const parts = scriptedStepParts([{ type: 'error' }]);

    expect(parts).toEqual([
      { type: 'error', error: new Error('scripted provider failure') },
    ]);
  });
});
