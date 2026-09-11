import { Logger } from '@nestjs/common';
import { z } from 'zod';

import { type TenantRunner } from '../db/tenant-db.service';
import {
  RESULT_TRUNCATE_CHARS,
  type UnknownRecord,
} from '@workspace/runtime-safety';
import { runTool } from './runner';
import { type Tool, type ToolContext } from './types';
import { compileToolPermissionMap } from './permissions/compile-permissions';
import { type ToolPermissionMap } from './permissions/types';
import { compileTestPermissionPolicy } from '../testing/tool-permission-policy';

function fakeContext(userId = 'user-A'): ToolContext {
  const tenantDb: TenantRunner = {
    runAs: <T>() =>
      Promise.reject<T>(new Error('tenant DB is not used by the echo tool')),
  };
  return {
    userId,
    chatId: 'chat-1',
    tenantDb,
    permissionPolicy: compileTestPermissionPolicy(['echo']),
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
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fails closed with no reads when identity is absent (D4)', async () => {
    const spy = vi.fn();
    const noIdentityTool: Tool<{ value: string }> = {
      ...echoTool,
      execute: (ctx, args) => {
        spy();
        return echoTool.execute(ctx, args);
      },
    };
    const result = await runTool(noIdentityTool, { value: 'x' }, undefined, 15);
    expect(result).toMatchObject({ status: 'error', type: 'no_context' });
    if (result.status !== 'error') {
      throw new Error('Expected a no-context error result.');
    }
    expect(result.message).toContain('resolvable run owner');
    expect(spy).not.toHaveBeenCalled();
  });

  it('validates input against the tool schema before executing', async () => {
    const result = await runTool(echoTool, { value: 123 }, fakeContext(), 15);
    expect(result).toMatchObject({ status: 'error', type: 'invalid_input' });
  });

  it('executes and returns the structured result on valid input', async () => {
    const result = await runTool(echoTool, { value: 'hi' }, fakeContext(), 15);
    expect(result).toEqual({ status: 'success', value: 'hi' });
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, 15.001])(
    'defensively refuses an invalid trusted timeout override of %s',
    async (timeoutSeconds) => {
      const execute = vi.fn(() => ({ status: 'success' as const }));

      const result = await runTool(
        { ...echoTool, timeoutSeconds, execute },
        { value: 'hi' },
        fakeContext(),
        15,
      );

      expect(result).toEqual({
        status: 'error',
        type: 'not_available',
        message: 'Tool "echo" is not available.',
      });
      expect(execute).not.toHaveBeenCalled();
    },
  );

  it('fires onValidated once input validation passes, before executing', async () => {
    const onValidated = vi.fn();
    await runTool(echoTool, { value: 'hi' }, fakeContext(), 15, onValidated);
    expect(onValidated).toHaveBeenCalledTimes(1);
  });

  it('never fires onValidated when input validation fails', async () => {
    const onValidated = vi.fn();
    await runTool(echoTool, { value: 123 }, fakeContext(), 15, onValidated);
    expect(onValidated).not.toHaveBeenCalled();
  });

  it('refuses a trusted timeout that AbortSignal cannot represent', async () => {
    const execute = vi.fn(() => ({ status: 'success' as const }));
    const result = await runTool(
      { ...echoTool, timeoutSeconds: 0.0001, execute },
      { value: 'x' },
      fakeContext(),
      15,
    );

    expect(result).toEqual({
      status: 'error',
      type: 'not_available',
      message: 'Tool "echo" is not available.',
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it('turns a thrown error into a structured, non-leaking error result', async () => {
    const throwingTool: Tool = {
      ...echoTool,
      execute: () => {
        throw new Error('secret internal detail: db://user:pass@host');
      },
    };
    const result = await runTool(
      throwingTool,
      { value: 'x' },
      fakeContext(),
      15,
    );
    expect(result).toMatchObject({ status: 'error', type: 'execution_failed' });
    expect(JSON.stringify(result)).not.toContain('secret internal detail');
  });

  it('classifies a cooperative rejection caused by the per-call timeout as timeout', async () => {
    const logSpy = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    let executionSignal: AbortSignal | undefined;
    const cooperativeTool: Tool = {
      ...echoTool,
      timeoutSeconds: 0.01,
      execute: ({ abortSignal }) => {
        executionSignal = abortSignal;
        return new Promise((_resolve, reject) => {
          abortSignal?.addEventListener(
            'abort',
            () => reject(new Error('cooperative timeout abort')),
            { once: true },
          );
        });
      },
    };

    const result = await runTool(
      cooperativeTool,
      { value: 'x' },
      fakeContext(),
      15,
    );

    expect(executionSignal?.aborted).toBe(true);
    expect(result).toMatchObject({ status: 'error', type: 'timeout' });
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('classifies a parent run abort as cancelled without logging it as an execution failure', async () => {
    const logSpy = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const abort = new AbortController();
    let executionStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      executionStarted = resolve;
    });
    let executionSignal: AbortSignal | undefined;
    const cooperativeTool: Tool = {
      ...echoTool,
      execute: ({ abortSignal }) => {
        executionSignal = abortSignal;
        executionStarted();
        return new Promise((_resolve, reject) => {
          abortSignal?.addEventListener(
            'abort',
            () => reject(new Error('cooperative parent abort')),
            { once: true },
          );
        });
      },
    };

    const resultPromise = runTool(
      cooperativeTool,
      { value: 'x' },
      { ...fakeContext(), abortSignal: abort.signal },
      15,
    );
    await started;
    abort.abort();
    const result = await resultPromise;

    expect(executionSignal).not.toBe(abort.signal);
    expect(executionSignal?.aborted).toBe(true);
    expect(result).toMatchObject({ status: 'error', type: 'cancelled' });
    expect(result).not.toMatchObject({ type: 'execution_failed' });
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('does not validate or execute a tool when the parent run is already aborted', async () => {
    const abort = new AbortController();
    abort.abort();
    const execute = vi.fn(() => ({ status: 'success' as const }));
    const onValidated = vi.fn();
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout');

    const result = await runTool(
      { ...echoTool, execute },
      { value: 123 },
      { ...fakeContext(), abortSignal: abort.signal },
      15,
      onValidated,
    );

    expect(result).toMatchObject({ status: 'error', type: 'cancelled' });
    expect(execute).not.toHaveBeenCalled();
    expect(onValidated).not.toHaveBeenCalled();
    expect(timeoutSpy).not.toHaveBeenCalled();
  });

  it('uses one shared timeout signal and bounds a tool that ignores it', async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout');
    let executionSignal: AbortSignal | undefined;
    const hangingTool: Tool = {
      ...echoTool,
      timeoutSeconds: 0.05,
      execute: ({ abortSignal }) => {
        executionSignal = abortSignal;
        return new Promise(() => {});
      },
    };
    const startedAt = Date.now();
    const result = await runTool(
      hangingTool,
      { value: 'x' },
      fakeContext(),
      15,
    );

    expect(timeoutSpy).toHaveBeenCalledTimes(1);
    expect(executionSignal).toBe(timeoutSpy.mock.results[0]?.value);
    expect(executionSignal?.aborted).toBe(true);
    expect(Date.now() - startedAt).toBeLessThan(1000);
    expect(result).toMatchObject({ status: 'error', type: 'timeout' });
  });

  it('passes the effective timeout separately from the composed execution signal', async () => {
    let observed: ToolContext | undefined;
    const parentAbort = new AbortController();
    const observingTool: Tool = {
      ...echoTool,
      execute: (context) => {
        observed = context;
        return { status: 'success' };
      },
    };

    await runTool(
      observingTool,
      { value: 'x' },
      { ...fakeContext(), abortSignal: parentAbort.signal },
      0.05,
    );

    expect(observed?.timeoutMs).toBe(50);
    expect(observed?.timeoutSignal).toBeDefined();
    expect(observed?.timeoutSignal).not.toBe(observed?.abortSignal);
  });

  it('truncates an oversized result with a visible marker', async () => {
    const bigTool: Tool = {
      ...echoTool,
      execute: () => ({ status: 'success', blob: 'x'.repeat(20_000) }),
    };
    const result = await runTool(bigTool, { value: 'x' }, fakeContext(), 15);
    expect(result).toMatchObject({ status: 'success', truncated: true });
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(
      RESULT_TRUNCATE_CHARS,
    );
    // SAFETY: toMatchObject only asserts at runtime, it doesn't narrow
    // result's static type; `blob` isn't part of ToolResult's declared shape,
    // it's the tool's own passthrough field (#294) — shape preservation is
    // covered in result-truncation.test.ts, this just pins the runner wiring.
    expect((result as UnknownRecord).blob).toEqual(expect.any(String));
  });

  it('fails closed when truncation receives a malformed oversized projection', async () => {
    const malformedTool: Tool = {
      ...echoTool,
      execute: () => ({
        status: 'success',
        toJSON: () =>
          Array.from({ length: RESULT_TRUNCATE_CHARS }, () => 'malformed'),
      }),
    };

    const result = await runTool(
      malformedTool,
      { value: 'x' },
      fakeContext(),
      15,
    );

    expect(result).toEqual({
      status: 'error',
      type: 'execution_failed',
      message: 'The tool failed to execute.',
    });
  });

  // The `<=` boundary in truncateOversizedResult (result-truncation.ts) —
  // exactly at the cap must survive untouched, one character over must
  // truncate.
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

describe('runTool permission gate', () => {
  const policyFor = (map: ToolPermissionMap) =>
    compileToolPermissionMap(map, 'test-policy');

  const contextWith = (map: ToolPermissionMap): ToolContext => ({
    ...fakeContext(),
    permissionPolicy: policyFor(map),
  });

  const contextWithoutPolicy: ToolContext = {
    userId: 'user-A',
    chatId: 'chat-1',
    tenantDb: {
      runAs: () => Promise.reject(new Error('tenant DB is not used')),
    },
  };

  const EXPLICIT_REJECT =
    'Tool call rejected before execution by operator permissions. A reject rule matched. Do not retry this call, disguise the same action through different commands or tools, delegate it to another agent, or change permission settings to bypass the rejection. In-run approval is unavailable. Continue with other permitted work; if this action is required, explain the blocked step to the user.';
  const NO_ALLOW =
    'Tool call rejected before execution by operator permissions. No allow rule permits this call. Do not retry this call, disguise the same action through different commands or tools, delegate it to another agent, or change permission settings to bypass the rejection. In-run approval is unavailable. Continue with other permitted work; if this action is required, explain the blocked step to the user.';
  const INVALID_FIELD =
    'Tool call rejected before execution by operator permissions. The configured permission rule is incompatible with this tool. Do not retry this call or change permission settings yourself. Report the configuration problem to the user and continue with other permitted work. In-run approval is unavailable.';
  const INPUT_LIMIT =
    'Tool call rejected before execution by operator permissions. The submitted input exceeds the permission inspection limit. Do not retry unchanged or evade a reject by splitting, encoding, switching tools, or delegating. A smaller request may be submitted only as independently permitted work. In-run approval is unavailable; explain any blocked required step to the user.';

  it('fails closed when no trusted policy is supplied', async () => {
    const execute = vi.fn(() => ({ status: 'success' as const, value: 'x' }));
    const tool: Tool = { ...echoTool, execute };
    const result = await runTool(tool, { value: 'x' }, contextWithoutPolicy, 5);
    expect(result).toEqual({
      status: 'error',
      type: 'permission_denied',
      message: NO_ALLOW,
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it('does not invoke the executor for a rejected call', async () => {
    const execute = vi.fn(() => ({ status: 'success' as const, value: 'x' }));
    const tool: Tool = { ...echoTool, execute };
    const result = await runTool(
      tool,
      { value: 'blocked' },
      contextWith({
        echo: { allow: true, reject: [{ field: 'value', literal: 'blocked' }] },
      }),
      5,
    );
    expect(result).toMatchObject({ type: 'permission_denied' });
    expect(execute).not.toHaveBeenCalled();
  });

  it('matches submitted values, not schema defaults', async () => {
    const tool: Tool = {
      ...echoTool,
      inputSchema: z.object({ value: z.string().default('default') }).strict(),
    };
    const result = await runTool(
      tool,
      {},
      contextWith({
        echo: { allow: true, reject: [{ field: 'value', literal: 'default' }] },
      }),
      5,
    );
    expect(result).toMatchObject({ status: 'success' });
  });

  it('matches submitted values, not transform output', async () => {
    const execute = vi.fn(() => ({ status: 'success' as const }));
    const tool: Tool = {
      ...echoTool,
      inputSchema: z
        .object({ value: z.string().transform((value) => value.toUpperCase()) })
        .strict(),
      execute,
    };
    const result = await runTool(
      tool,
      { value: 'x' },
      contextWith({
        echo: { allow: true, reject: [{ field: 'value', literal: 'x' }] },
      }),
      5,
    );
    expect(result).toMatchObject({ type: 'permission_denied' });
    expect(execute).not.toHaveBeenCalled();
  });

  it('fires the admission callback with the decision before dispatch', async () => {
    const order: Array<string> = [];
    const tool: Tool = {
      ...echoTool,
      execute: () => {
        order.push('execute');
        return { status: 'success' as const };
      },
    };
    await runTool(
      tool,
      { value: 'x' },
      {
        ...fakeContext(),
        permissionPolicy: compileTestPermissionPolicy(['echo']),
      },
      5,
      (decision) => {
        order.push(`admitted:${decision.decision}`);
      },
    );
    expect(order).toEqual(['admitted:allow', 'execute']);
  });

  it.each([
    {
      name: 'explicit_reject',
      message: EXPLICIT_REJECT,
      tool: echoTool,
      args: { value: 'blocked' },
      map: {
        echo: {
          allow: true,
          reject: [{ field: 'value', literal: 'blocked' }],
        },
      } satisfies ToolPermissionMap,
    },
    {
      name: 'no_allow',
      message: NO_ALLOW,
      tool: echoTool,
      args: { value: 'x' },
      map: {
        echo: { allow: [{ field: 'value', literal: 'never' }] },
      } satisfies ToolPermissionMap,
    },
    {
      name: 'invalid_field',
      message: INVALID_FIELD,
      tool: {
        ...echoTool,
        id: 'mcp__demo__lookup',
        inputSchema: {
          type: 'object',
          properties: { query: { type: 'string' } },
        },
      },
      args: { query: 'x' },
      map: {
        mcp__demo__lookup: {
          allow: [{ field: 'url', literal: 'x' }],
        },
      } satisfies ToolPermissionMap,
    },
    {
      name: 'input_limit',
      message: INPUT_LIMIT,
      tool: echoTool,
      args: { value: 'y'.repeat(1024 * 1024 + 1) },
      map: {
        echo: { allow: true, reject: [{ allFields: true, literal: 'X' }] },
      } satisfies ToolPermissionMap,
    },
  ] as const)(
    'uses the fixed message for $name',
    async ({ message, tool, args, map }) => {
      const result = await runTool(tool, args, contextWith(map), 5);
      expect(result).toEqual({
        status: 'error',
        type: 'permission_denied',
        message,
      });
    },
  );
});
