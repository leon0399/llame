/**
 * The `bash` half of the `ssh://` admission: which calls it owns, the refusals
 * that need no destination, and the canonical locator it reports only when the
 * submitted text is not already the canonical one.
 */
import {
  type SshClient,
  type SshResolution,
  type SshResolvedDestination,
} from '../ssh/ssh-client';
import { bashTool } from './bash';
import { nativeReadTool } from './native-files';
import { compileToolPermissionMap } from './permissions/compile-permissions';
import { type ToolPermissionMap } from './permissions/types';
import { admitSshBash, admitSshRead, isSshBash } from './ssh-admission';
import { type ToolContext } from './types';

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
  });
});

describe('admitSshBash refusals', () => {
  it('reports a cancelled resolution under the bash tool name', async () => {
    const { client } = fakeSsh({ outcome: 'cancelled' });

    await expect(
      admitSshBash(
        { cwd: 'ssh://box/tmp' },
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
      admitSshBash({ cwd: 'ssh://' }, context({}, { sshClient: client })),
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
        { cwd: 'ssh://box/tmp' },
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
      { cwd: 'ssh://box@box:22/srv/app' },
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
      { cwd: 'ssh://box/srv/app' },
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
