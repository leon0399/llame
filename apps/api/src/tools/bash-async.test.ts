import { z } from 'zod';
import { bashTool } from './bash';
import { bashTarget, isHostBashCall } from './bash-target';
import { createWorkspaceRootCell } from './workspace-path';
import { type ToolContext } from './types';
import { compileTestPermissionPolicy } from '../testing/tool-permission-policy';

const context: ToolContext = {
  userId: 'owner',
  chatId: 'chat',
  configuredCredentials: [],
  permissionPolicy: compileTestPermissionPolicy(),
  tenantDb: {
    runAs: () => {
      throw new Error('No durable admission expected');
    },
  },
};

const inputSchema = bashTool.inputSchema;

if (!(inputSchema instanceof z.ZodType))
  throw new Error('Bash must use its strict Zod input schema');

describe('host-only background fields', () => {
  it('The background fields are accepted', () => {
    expect(
      inputSchema.parse({
        command: 'true',
        async: true,
        unlimited: false,
      }),
    ).toEqual({ command: 'true', async: true, unlimited: false });
  });
  it.each(['duration', 'maxSeconds', 'timeout', 'nativeExecutorId'])(
    'Model cannot widen execution with %s',
    (key) => {
      expect(
        inputSchema.safeParse({
          command: 'true',
          async: true,
          [key]: 36_000,
        }).success,
      ).toBe(false);
    },
  );
  it.each(['ssh://host/tmp', 'machine://dev/tmp'])(
    'A remote directory refuses async: %s',
    async (cwd) => {
      const result = await bashTool.execute(context, {
        command: 'true',
        cwd,
        async: true,
      });

      expect(result).toMatchObject({ status: 'error', type: 'invalid_input' });
      expect(result.status === 'error' ? result.message : '').toContain(
        'llame host',
      );
      expect(
        await bashTool.execute(context, {
          command: 'true',
          cwd,
          unlimited: false,
        }),
      ).toMatchObject({ type: 'invalid_input' });
    },
  );
  it('requires a string command before classifying host bash', () => {
    expect(isHostBashCall({}, context)).toBe(false);
  });

  it('rejects invalid and remote projected directories as host calls', () => {
    const machine = {
      ...context,
      workspaceRoot: createWorkspaceRootCell('machine://dev/tmp/project'),
    };

    expect(
      isHostBashCall({ command: 'true', cwd: 'relative/path' }, machine),
    ).toBe(false);
    expect(
      isHostBashCall({ command: 'true', cwd: 'ssh://host/tmp' }, context),
    ).toBe(false);
  });

  it('refuses an omitted cwd in a Machine Workspace after projection', async () => {
    const machine = {
      ...context,
      workspaceRoot: createWorkspaceRootCell('machine://dev/tmp/project'),
    };

    expect(bashTarget(machine, { command: 'true' })).toMatchObject({
      target: 'machine',
      input: { cwd: 'machine://dev/tmp/project' },
    });
    expect(
      await bashTool.execute(machine, { command: 'true', async: true }),
    ).toMatchObject({ type: 'invalid_input' });
  });
  it('An unlimited job is refused by default', async () => {
    const result = await bashTool.execute(context, {
      command: 'true',
      async: true,
      unlimited: true,
    });

    expect(result).toMatchObject({ type: 'invalid_input' });
    expect(result.status === 'error' ? result.message : '').toContain(
      'tools.jobs.allowUnlimited',
    );
  });
});
