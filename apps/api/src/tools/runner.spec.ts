import { RESULT_TRUNCATE_CHARS, runTool } from './runner';
import { type Tool, type ToolContext } from './types';
import { z } from 'zod';

function fakeContext(userId = 'user-A'): ToolContext {
  return {
    userId,
    chatId: 'chat-1',
    tenantDb: {} as unknown as ToolContext['tenantDb'],
  };
}

const echoTool: Tool<{ value: string }> = {
  id: 'echo',
  description: 'echoes the input',
  classification: 'read_only',
  inputSchema: z.object({ value: z.string() }).strict(),
  execute: (_ctx, { value }) => ({ status: 'success', value }),
};

describe('runTool', () => {
  it('fails closed with no reads when identity is absent (D4)', async () => {
    const spy = jest.fn();
    const noIdentityTool: Tool<{ value: string }> = {
      ...echoTool,
      execute: (ctx, args) => {
        spy();
        return echoTool.execute(ctx, args);
      },
    };
    const result = await runTool(
      noIdentityTool,
      { value: 'x' },
      undefined,
      15,
    );
    expect(result).toEqual({
      status: 'error',
      type: 'no_context',
      message: expect.stringContaining('resolvable run owner') as string,
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it('validates input against the tool schema before executing', async () => {
    const result = await runTool(
      echoTool,
      { value: 123 },
      fakeContext(),
      15,
    );
    expect(result).toMatchObject({ status: 'error', type: 'invalid_input' });
  });

  it('executes and returns the structured result on valid input', async () => {
    const result = await runTool(
      echoTool,
      { value: 'hi' },
      fakeContext(),
      15,
    );
    expect(result).toEqual({ status: 'success', value: 'hi' });
  });

  it('fires onValidated once input validation passes, before executing', async () => {
    const onValidated = jest.fn();
    await runTool(echoTool, { value: 'hi' }, fakeContext(), 15, onValidated);
    expect(onValidated).toHaveBeenCalledTimes(1);
  });

  it('never fires onValidated when input validation fails', async () => {
    const onValidated = jest.fn();
    await runTool(echoTool, { value: 123 }, fakeContext(), 15, onValidated);
    expect(onValidated).not.toHaveBeenCalled();
  });

  it('turns a thrown error into a structured, non-leaking error result', async () => {
    const throwingTool: Tool = {
      ...echoTool,
      execute: () => {
        throw new Error('secret internal detail: db://user:pass@host');
      },
    };
    const result = await runTool(throwingTool, { value: 'x' }, fakeContext(), 15);
    expect(result).toMatchObject({ status: 'error', type: 'execution_failed' });
    expect(JSON.stringify(result)).not.toContain('secret internal detail');
  });

  it('times out a tool that never resolves (registry-owned timeout)', async () => {
    const hangingTool: Tool = {
      ...echoTool,
      timeoutSeconds: 0.05,
      execute: () => new Promise(() => {}),
    };
    const result = await runTool(hangingTool, { value: 'x' }, fakeContext(), 15);
    expect(result).toMatchObject({ status: 'error', type: 'timeout' });
  });

  it('truncates an oversized result with a visible marker', async () => {
    const bigTool: Tool = {
      ...echoTool,
      execute: () => ({ status: 'success', blob: 'x'.repeat(20_000) }),
    };
    const result = await runTool(bigTool, { value: 'x' }, fakeContext(), 15);
    expect(result).toMatchObject({ status: 'success', truncated: true });
    expect(JSON.stringify(result).length).toBeLessThan(20_000);
  });

  // The `<=` boundary in truncateIfOversized (runner.ts) — exactly at the
  // cap must survive untouched, one character over must truncate.
  function resultPaddedToJsonLength(targetLength: number): Tool {
    const overhead = JSON.stringify({ status: 'success', value: '' }).length;
    const value = 'x'.repeat(targetLength - overhead);
    return { ...echoTool, execute: () => ({ status: 'success', value }) };
  }

  it('does not truncate a result whose JSON is exactly RESULT_TRUNCATE_CHARS', async () => {
    const tool = resultPaddedToJsonLength(RESULT_TRUNCATE_CHARS);
    const result = await runTool(tool, { value: 'x' }, fakeContext(), 15);
    expect(JSON.stringify(result).length).toBe(RESULT_TRUNCATE_CHARS);
    expect(result).not.toMatchObject({ truncated: true });
  });

  it('truncates a result whose JSON is RESULT_TRUNCATE_CHARS + 1', async () => {
    const tool = resultPaddedToJsonLength(RESULT_TRUNCATE_CHARS + 1);
    const result = await runTool(tool, { value: 'x' }, fakeContext(), 15);
    expect(result).toMatchObject({ status: 'success', truncated: true });
  });
});
