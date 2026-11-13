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
});
