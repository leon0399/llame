/**
 * The `bash` half of the `ssh://` admission: which calls it owns, the refusals
 * that need no destination, the arguments the permission rules see, and the
 * canonical locator it reports only when the submitted text is not already the
 * canonical one.
 */
import { z } from 'zod';

import {
  type SshClient,
  type SshResolution,
  type SshResolvedDestination,
} from '../ssh/ssh-client';
import { bashTool } from './bash';
import { nativeReadTool } from './native-files';
import { compileToolPermissionMap } from './permissions/compile-permissions';
import { type ToolPermissionMap } from './permissions/types';
import { runTool } from './runner';
import {
  admitSshBash,
  admitSshRead,
  isSshBash,
  type SshAdmission,
} from './ssh-admission';
import { type Tool, type ToolContext } from './types';

const RESOLVED: SshResolvedDestination = {
  user: 'box',
  host: 'box',
  port: 22,
};

function context(
  map: ToolPermissionMap = { bash: { allow: true } },
  overrides: Partial<ToolContext> = {},
): ToolContext {
  return {
    userId: 'owner',
    chatId: 'chat',
    permissionPolicy: compileToolPermissionMap(map, 'test-policy'),
    tenantDb: {
      runAs: <T>() =>
        Promise.reject<T>(new Error('tenant DB is not used by these tests')),
    },
    ...overrides,
  };
}

function fakeSsh(
  resolution: SshResolution = { outcome: 'resolved', destination: RESOLVED },
) {
  const resolve = vi.fn<SshClient['resolve']>(() =>
    Promise.resolve(resolution),
  );
  const client: SshClient = {
    resolve,
    run: () =>
      Promise.resolve({
        outcome: 'failed',
        reason: 'client_missing',
        diagnostic: 'ssh is not installed',
      }),
    sshConfigText: () => undefined,
    dispose: () => undefined,
  };
  return { client, resolve };
}

describe('isSshBash', () => {
  it('owns only a bash call whose cwd is an ssh:// locator', () => {
    expect(isSshBash(bashTool, { command: 'pwd', cwd: 'ssh://box/tmp' })).toBe(
      true,
    );
    expect(isSshBash(bashTool, { command: 'pwd', cwd: '/tmp' })).toBe(false);
    // Another tool's ssh:// argument is not the bash admission's to decide.
    expect(isSshBash(nativeReadTool, { cwd: 'ssh://box/tmp' })).toBe(false);
    // A call without the command the group must also see is not one either.
    expect(isSshBash(bashTool, { cwd: 'ssh://box/tmp' })).toBe(false);
  });
});

describe('admitSshBash refusals', () => {
  it('reports a cancelled resolution under the bash tool name', async () => {
    const { client } = fakeSsh({ outcome: 'cancelled' });

    await expect(
      admitSshBash(
        { command: 'pwd', cwd: 'ssh://box/tmp' },
        context({}, { sshClient: client }),
      ),
    ).resolves.toEqual({
      kind: 'refused',
      result: {
        status: 'error',
        type: 'cancelled',
        message: 'Tool "bash" was cancelled.',
      },
    });
  });

  it('asks for an absolute path when the locator names only a destination', async () => {
    const { client, resolve } = fakeSsh();

    await expect(
      admitSshBash(
        { command: 'pwd', cwd: 'ssh://' },
        context({}, { sshClient: client }),
      ),
    ).resolves.toEqual({
      kind: 'refused',
      result: {
        status: 'error',
        type: 'invalid_path',
        message:
          'An ssh:// working directory needs an absolute path after the destination, like ssh://box/tmp.',
      },
    });
    expect(resolve).not.toHaveBeenCalled();
  });

  it('leaves a read alone when no trusted policy exists', async () => {
    const { client, resolve } = fakeSsh();

    await expect(
      admitSshRead(
        { path: 'ssh://box/tmp' },
        context({}, { sshClient: client, permissionPolicy: undefined }),
      ),
    ).resolves.toEqual({ kind: 'none' });
    expect(resolve).not.toHaveBeenCalled();
  });

  it('leaves a bash call alone when no trusted policy exists', async () => {
    const { client, resolve } = fakeSsh();

    await expect(
      admitSshBash(
        { command: 'pwd', cwd: 'ssh://box/tmp' },
        context({}, { sshClient: client, permissionPolicy: undefined }),
      ),
    ).resolves.toEqual({ kind: 'none' });
    expect(resolve).not.toHaveBeenCalled();
  });
});

describe('admitSshBash canonical locator', () => {
  it('does not report a derived decision when the text is already canonical', async () => {
    const { client } = fakeSsh();
    const onDerivedDecision = vi.fn();

    const admission = await admitSshBash(
      { command: 'pwd', cwd: 'ssh://box@box:22/srv/app' },
      context(
        {
          bash: { allow: [{ field: 'cwd', regex: '^ssh://box@box:22/srv/' }] },
        },
        { sshClient: client, onDerivedDecision },
      ),
    );

    expect(admission.kind).toBe('decided');
    expect(onDerivedDecision).not.toHaveBeenCalled();
  });

  it('reports a derived decision when resolution changes the text', async () => {
    const { client } = fakeSsh();
    const onDerivedDecision = vi.fn();

    await admitSshBash(
      { command: 'pwd', cwd: 'ssh://box/srv/app' },
      context(
        {
          bash: { allow: [{ field: 'cwd', regex: '^ssh://box@box:22/srv/' }] },
        },
        { sshClient: client, onDerivedDecision },
      ),
    );

    expect(onDerivedDecision).toHaveBeenCalledOnce();
  });
});

/** The refusal one admission became, or a failure naming what arrived. */
function refusal(admission: SshAdmission) {
  if (admission.kind !== 'refused')
    throw new Error(`expected a refusal, got ${admission.kind}`);
  return admission.result;
}

const ENV_REFUSALS: ReadonlyArray<{
  readonly label: string;
  readonly env: Record<string, string>;
  readonly message: string;
}> = [
  {
    label: 'a key carrying shell text',
    env: { 'X=1; id; Y': 'v' },
    message: 'is not a valid name',
  },
  { label: 'a NUL value', env: { TOKEN: 'a\0b' }, message: 'NUL' },
  {
    label: 'a managed base variable',
    env: { PATH: '/tmp' },
    message:
      'Environment variable PATH cannot replace a managed base variable.',
  },
];

describe('admitSshBash argument refusals', () => {
  it.each(ENV_REFUSALS)(
    'refuses $label before resolving the destination',
    async ({ env, message }) => {
      const { client, resolve } = fakeSsh();

      const result = refusal(
        await admitSshBash(
          { command: 'printf never', cwd: 'ssh://box/tmp', env },
          context({}, { sshClient: client }),
        ),
      );

      expect(result).toMatchObject({ status: 'error', type: 'unavailable' });
      expect(result.status === 'error' && result.message).toContain(message);
      expect(resolve).not.toHaveBeenCalled();
    },
  );

  it('refuses a command with NUL before resolving the destination', async () => {
    const { client, resolve } = fakeSsh();

    const result = refusal(
      await admitSshBash(
        { command: 'r\0m -rf /srv', cwd: 'ssh://box/tmp' },
        context({}, { sshClient: client }),
      ),
    );

    expect(result).toMatchObject({ status: 'error', type: 'invalid_input' });
    expect(result.status === 'error' && result.message).toContain(
      'must not contain NUL',
    );
    expect(resolve).not.toHaveBeenCalled();
  });
});

/** A `bash` tool that observes the context execution actually receives. */
function bashProbe() {
  const execute = vi.fn(
    (executionContext: ToolContext, { cwd }: { cwd: string }) => ({
      status: 'success' as const,
      cwd,
      binding: executionContext.sshBinding,
    }),
  );
  const tool: Tool<{
    command: string;
    cwd: string;
    env?: Record<string, string>;
  }> = {
    id: 'bash',
    description: 'runs a command',
    classification: 'execute_code',
    inputSchema: z.strictObject({
      command: z.string(),
      cwd: z.string(),
      env: z.record(z.string(), z.string()).optional(),
    }),
    execute,
  };
  return { tool, execute };
}

describe('ssh bash permission projection', () => {
  it('refuses a command reject the submitted arguments carry', async () => {
    const probe = bashProbe();
    const ssh = fakeSsh();

    const result = await runTool(
      probe.tool,
      { command: 'rm -rf /srv', cwd: 'ssh://box/tmp' },
      context(
        {
          bash: {
            allow: true,
            reject: [{ field: 'command', regex: 'rm -rf' }],
          },
        },
        { sshClient: ssh.client },
      ),
      5,
    );

    expect(result).toMatchObject({
      status: 'error',
      type: 'permission_denied',
    });
    expect(probe.execute).not.toHaveBeenCalled();
    expect(ssh.resolve).not.toHaveBeenCalled();
  });

  it('admits a call a command-only allow names', async () => {
    const probe = bashProbe();

    const result = await runTool(
      probe.tool,
      { command: 'pwd', cwd: 'ssh://box/tmp' },
      context(
        { bash: { allow: [{ field: 'command', regex: '^pwd$' }] } },
        { sshClient: fakeSsh().client },
      ),
      5,
    );

    expect(result).toMatchObject({ status: 'success' });
    expect(probe.execute).toHaveBeenCalledOnce();
  });

  it('lets an all-fields reject find env text', async () => {
    const probe = bashProbe();

    const result = await runTool(
      probe.tool,
      {
        command: 'true',
        cwd: 'ssh://box/tmp',
        env: { TOKEN: 'sk-live-secret' },
      },
      context(
        {
          bash: {
            allow: true,
            reject: [{ allFields: true, regex: 'sk-live' }],
          },
        },
        { sshClient: fakeSsh().client },
      ),
      5,
    );

    expect(result).toMatchObject({
      status: 'error',
      type: 'permission_denied',
    });
    expect(probe.execute).not.toHaveBeenCalled();
  });
});
