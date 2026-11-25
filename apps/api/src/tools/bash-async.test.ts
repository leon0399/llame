import { z } from 'zod';
import { bashTool } from './bash';
import { bashTarget, isHostBashCall } from './bash-target';
import { createWorkspaceRootCell } from './workspace-path';
import { type ToolContext } from './types';
import { localMachineConnector } from '../testing/local-machine';
import { compileTestPermissionPolicy } from '../testing/tool-permission-policy';

const context: ToolContext = {
  userId: 'owner',
  chatId: 'chat',
  runId: 'run',
  attemptId: 'attempt-1',
  localMachine: 'host-a',
  defaultMachine: 'host-a',
  machines: localMachineConnector(),
  nativeDeliverySequence: 1,
  toolCallId: 'call-1',
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
  it.each(['duration', 'maxSeconds', 'timeout', 'localMachine'])(
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
  it('refuses async on an ssh:// directory without starting a process', async () => {
    const result = await bashTool.execute(context, {
      command: 'true',
      cwd: 'ssh://host/tmp',
      async: true,
    });

    expect(result).toMatchObject({ status: 'error', type: 'invalid_input' });
    expect(result.status === 'error' ? result.message : '').toContain(
      'llame host',
    );
    expect(
      await bashTool.execute(context, {
        command: 'true',
        cwd: 'ssh://host/tmp',
        unlimited: false,
      }),
    ).toMatchObject({ type: 'invalid_input' });
  });
  it('requires a string command before classifying host bash', () => {
    expect(isHostBashCall({}, context)).toBe(false);
  });

  it('rejects invalid and remote projected directories as host calls', () => {
    const machine = {
      ...context,
      workspaceRoot: createWorkspaceRootCell('machine://gpu/tmp/project'),
    };

    expect(
      isHostBashCall({ command: 'true', cwd: 'relative/path' }, machine),
    ).toBe(false);
    expect(
      isHostBashCall({ command: 'true', cwd: 'ssh://host/tmp' }, context),
    ).toBe(false);
  });

  it('treats the local Machine of the call as host bash', () => {
    expect(isHostBashCall({ command: 'true' }, context)).toBe(true);
    expect(
      isHostBashCall({ command: 'true', cwd: 'machine://host-a/tmp' }, context),
    ).toBe(true);
    expect(isHostBashCall({ command: 'true', cwd: '/tmp' }, context)).toBe(
      true,
    );
  });

  it('projects the current Machine Workspace into a Machine bash target', () => {
    const machine = {
      ...context,
      workspaceRoot: createWorkspaceRootCell('machine://gpu/tmp/project'),
    };

    expect(bashTarget(machine, { command: 'true' })).toMatchObject({
      target: 'machine',
      input: { cwd: 'machine://gpu/tmp/project' },
      machine: { name: 'gpu', path: '/tmp/project', local: false },
    });
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
