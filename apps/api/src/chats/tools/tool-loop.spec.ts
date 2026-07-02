import { stepCountIs, streamText, tool } from 'ai';
import { MockLanguageModelV3, simulateReadableStream } from 'ai/test';

import { getCurrentTimeTool } from './get-current-time';

/**
 * Mechanism test for the tool-calling loop (MVP): drives the REAL AI SDK v6
 * multi-step loop with a scripted MockLanguageModelV3 — the same
 * `streamText({ tools, stopWhen: stepCountIs(N) })` wiring the provider
 * clients use — proving the behaviors run-execution depends on:
 *  (1) the SDK auto-executes a tool call and re-calls the model,
 *  (2) the tool wrapper's events fire in order (call → result) around execute,
 *  (3) `stopWhen` hard-caps a model that never stops calling tools.
 * Deterministic, no provider, no DB.
 */

/* Test scaffolding builds AI SDK v3 stream parts by hand and casts to the
   SDK's internal chunk types — the unsafe-* rules don't add value here. */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-return */

function toolCallResponse(toolName: string, input: unknown) {
  return {
    stream: simulateReadableStream({
      chunks: [
        { type: 'stream-start', warnings: [] },
        {
          type: 'tool-call',
          toolCallId: `call-${Math.round(input ? 1 : 0)}`,
          toolName,
          input: JSON.stringify(input),
        },
        {
          type: 'finish',
          finishReason: 'tool-calls',
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        },
      ] as any,
    }),
  } as any;
}

function textResponse(text: string) {
  return {
    stream: simulateReadableStream({
      chunks: [
        { type: 'stream-start', warnings: [] },
        { type: 'text-start', id: 't1' },
        { type: 'text-delta', id: 't1', delta: text },
        { type: 'text-end', id: 't1' },
        {
          type: 'finish',
          finishReason: 'stop',
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        },
      ] as any,
    }),
  } as any;
}

/** The event-emitting wrapper, mirroring run-execution.executeRun's tool set. */
function wrappedTool(events: string[]) {
  return tool({
    description: getCurrentTimeTool.description,
    inputSchema: getCurrentTimeTool.inputSchema,
    execute: async (args: unknown) => {
      events.push('tool.call');
      const result = await getCurrentTimeTool.execute(args as never);
      events.push('tool.result');
      return result;
    },
  });
}

describe('tool-calling loop (AI SDK v6 mechanism)', () => {
  it('executes a tool call then streams the follow-up answer', async () => {
    const events: string[] = [];
    let turn = 0;
    const model = new MockLanguageModelV3({
      // Turn 1: call the tool. Turn 2: answer with text.
      doStream: () => {
        turn += 1;
        return Promise.resolve(
          turn === 1
            ? toolCallResponse('get_current_time', { timezone: 'UTC' })
            : textResponse('It is currently that time.'),
        );
      },
    });

    const result = streamText({
      model,
      tools: { get_current_time: wrappedTool(events) },
      stopWhen: stepCountIs(4),
      messages: [{ role: 'user', content: 'what time is it?' }],
    });
    await result.consumeStream();
    const text = await result.text;

    expect(events).toEqual(['tool.call', 'tool.result']);
    expect(text).toBe('It is currently that time.');
    // The SDK re-called the model after the tool (2 provider turns).
    expect(model.doStreamCalls.length).toBe(2);
  });

  it('stopWhen hard-caps a model that never stops calling tools', async () => {
    const events: string[] = [];
    const model = new MockLanguageModelV3({
      // A runaway: every turn is another tool call, no text ever.
      doStream: () => Promise.resolve(toolCallResponse('get_current_time', {})),
    });

    const result = streamText({
      model,
      tools: { get_current_time: wrappedTool(events) },
      stopWhen: stepCountIs(3),
      messages: [{ role: 'user', content: 'loop forever' }],
    });
    await result.consumeStream();

    // Exactly the cap: 3 model turns → 3 tool executions, then stop.
    expect(model.doStreamCalls.length).toBe(3);
    expect(events.filter((e) => e === 'tool.call')).toHaveLength(3);
  });
});
