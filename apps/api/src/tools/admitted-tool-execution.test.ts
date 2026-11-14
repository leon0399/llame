import { type TenantRunner } from '../db/tenant-db.service';
import { bashTool } from './bash';
import { executeAdmittedTool } from './admitted-tool-execution';
import { type ToolContext, type ToolResult } from './types';

describe('executeAdmittedTool', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('classifies an aborted host bash call before command start as cancelled', async () => {
    const abort = new AbortController();
    const { promise: execution } = Promise.withResolvers<ToolResult>();

    const execute = vi.spyOn(bashTool, 'execute').mockImplementation(() => {
      abort.abort();

      return execution;
    });

    const onNativeMutationUnknown = vi.fn();

    const context: ToolContext = {
      userId: 'owner',
      chatId: 'chat',
      configuredCredentials: [],
      tenantDb: {
        runAs: <T>() => Promise.reject<T>(new Error('unused tenant DB')),
      } satisfies TenantRunner,
      abortSignal: abort.signal,
      onNativeMutationUnknown,
    };

    const result = await executeAdmittedTool(
      bashTool,
      { command: 'printf never-started' },
      context,
      1,
    );

    expect(result).toMatchObject({ status: 'error', type: 'cancelled' });
    expect(execute).toHaveBeenCalledOnce();
    expect(onNativeMutationUnknown).not.toHaveBeenCalled();
  });

  it('classifies a host bash call aborted by a message before command start', async () => {
    const yielded = new AbortController();

    const execute = vi.spyOn(bashTool, 'execute').mockImplementation(() => {
      yielded.abort();

      return Promise.reject(new Error('cancelled before command start'));
    });

    const onHostCommandStarted = vi.fn();
    const onHostPromotionStarted = vi.fn();

    const context: ToolContext = {
      userId: 'owner',
      chatId: 'chat',
      configuredCredentials: [],
      tenantDb: {
        runAs: <T>() => Promise.reject<T>(new Error('unused tenant DB')),
      } satisfies TenantRunner,
      yieldSignal: yielded.signal,
      onHostCommandStarted,
      onHostPromotionStarted,
    };

    const result = await executeAdmittedTool(
      bashTool,
      { command: 'printf never-started' },
      context,
      1,
    );

    expect(result).toMatchObject({ status: 'error', type: 'cancelled' });
    expect(onHostCommandStarted).not.toHaveBeenCalled();
    expect(onHostPromotionStarted).not.toHaveBeenCalled();
    expect(execute).toHaveBeenCalledOnce();
  });

  it('keeps a failed remote bash call unknown after a message yield', async () => {
    const yielded = new AbortController();
    let executionContext: ToolContext | undefined;

    const execute = vi
      .spyOn(bashTool, 'execute')
      .mockImplementation((context) => {
        executionContext = context;
        yielded.abort();

        return Promise.reject(new Error('remote command transport failed'));
      });

    const context: ToolContext = {
      userId: 'owner',
      chatId: 'chat',
      configuredCredentials: [],
      tenantDb: {
        runAs: <T>() => Promise.reject<T>(new Error('unused tenant DB')),
      } satisfies TenantRunner,
      yieldSignal: yielded.signal,
    };

    const result = await executeAdmittedTool(
      bashTool,
      { command: 'printf remote', cwd: 'ssh://build/tmp' },
      context,
      1,
    );

    expect(result).toMatchObject({ status: 'error', type: 'outcome_unknown' });
    expect(executionContext?.timeoutSignal).toBeDefined();
    expect(executionContext?.moveSignal).toBeUndefined();
    expect(execute).toHaveBeenCalledOnce();
  });

  it('forwards host command and promotion event notifications', async () => {
    const commandStarted = vi.fn();
    const promotionStarted = vi.fn();
    const onNativeMutationUnknown = vi.fn();

    const execute = vi
      .spyOn(bashTool, 'execute')
      .mockImplementation((context) => {
        context.onHostCommandStarted?.();
        context.onHostPromotionStarted?.();

        return Promise.resolve({ status: 'success', stdout: 'done' });
      });

    const context: ToolContext = {
      userId: 'owner',
      chatId: 'chat',
      configuredCredentials: [],
      tenantDb: {
        runAs: <T>() => Promise.reject<T>(new Error('unused tenant DB')),
      } satisfies TenantRunner,
      onHostCommandStarted: commandStarted,
      onHostPromotionStarted: promotionStarted,
      onNativeMutationUnknown,
    };

    const result = await executeAdmittedTool(
      bashTool,
      { command: 'printf local' },
      context,
      1,
    );

    expect(result).toEqual({ status: 'success', stdout: 'done' });
    expect(commandStarted).toHaveBeenCalledOnce();
    expect(promotionStarted).toHaveBeenCalledOnce();
    expect(onNativeMutationUnknown).not.toHaveBeenCalled();
    expect(execute).toHaveBeenCalledOnce();
  });
});
