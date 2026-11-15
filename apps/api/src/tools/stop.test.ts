import { compileToolPermissionMap } from './permissions/compile-permissions';
import { runTool } from './runner';
import { stopTool } from './stop';
import { type ToolContext } from './types';

const unreachableDb: ToolContext['tenantDb'] = {
  runAs: () => {
    throw new Error('The database must not be reached');
  },
};

function context(over: Partial<ToolContext> = {}): ToolContext {
  return {
    configuredCredentials: [],
    userId: 'owner',
    chatId: 'chat',
    nativeExecutorId: 'host',
    tenantDb: unreachableDb,
    permissionPolicy: compileToolPermissionMap({ stop: { allow: true } }, 'p'),
    ...over,
  };
}

const input = { jobs: ['job://bash-4'] };

describe('stop admission', () => {
  it('fails closed before any database read without a native host identity', async () => {
    const result = await runTool(
      stopTool,
      input,
      context({ nativeExecutorId: undefined }),
      5,
    );

    expect(result).toMatchObject({
      status: 'error',
      type: 'executor_unavailable',
    });
  });

  it('refuses a malformed later locator before any database read', async () => {
    const result = await runTool(
      stopTool,
      { jobs: ['job://bash-4', 'job://bash-5/stdout'] },
      context(),
      5,
    );

    expect(result).toMatchObject({ status: 'error', type: 'invalid_input' });
  });

  it('needs its own permission group', async () => {
    const result = await runTool(
      stopTool,
      input,
      context({ permissionPolicy: compileToolPermissionMap({}, 'p') }),
      5,
    );

    expect(result).toMatchObject({
      status: 'error',
      type: 'permission_denied',
    });
  });

  it('is refused in a read-only Run before any read or write', async () => {
    const result = await runTool(
      stopTool,
      input,
      context({ permissionMode: 'read-only' }),
      5,
    );

    expect(result).toMatchObject({
      status: 'error',
      type: 'permission_denied',
    });
  });

  it('matches each entry as lower-case text against a reject clause', async () => {
    const result = await runTool(
      stopTool,
      { jobs: ['JOB://bash-4'] },
      context({
        permissionPolicy: compileToolPermissionMap(
          {
            stop: {
              allow: true,
              reject: [{ allFields: true, regex: '^job://bash-4$' }],
            },
          },
          'p',
        ),
      }),
      5,
    );

    expect(result).toMatchObject({
      status: 'error',
      type: 'permission_denied',
    });
  });

  it.each([[[]], [Array.from({ length: 17 }, (_, i) => `job://bash-${i}`)]])(
    'accepts only 1 to 16 locators',
    async (jobs) => {
      await expect(
        runTool(stopTool, { jobs }, context(), 5),
      ).resolves.toMatchObject({ status: 'error', type: 'invalid_input' });
    },
  );
});
