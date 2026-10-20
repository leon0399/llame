import { z } from 'zod';

import { type TenantRunner } from '../db/tenant-db.service';
import {
  type SshClient,
  type SshResolution,
  type SshResolvedDestination,
} from '../ssh/ssh-client';
import {
  nativeEditTool,
  nativeReadTool,
  nativeWriteTool,
} from './native-files';
import { compileToolPermissionMap } from './permissions/compile-permissions';
import { type ToolPermissionMap } from './permissions/types';
import { previewToolPermission, runTool } from './runner';
import { admitSshRead } from './ssh-admission';
import { type Tool, type ToolContext } from './types';
import {
  createWorkspaceRootCell,
  type WorkspaceRootCell,
} from './workspace-path';
import { enterWorkspaceTool } from './workspace';

const RESOLVED: SshResolvedDestination = {
  user: 'box',
  host: 'box',
  port: 22,
};

const tenantDb: TenantRunner = {
  runAs: <T>() =>
    Promise.reject<T>(new Error('tenant DB is not used by these tests')),
};

function permissionPolicy(map: ToolPermissionMap) {
  return compileToolPermissionMap(map, 'test-policy');
}

function context(
  map: ToolPermissionMap,
  overrides: Partial<ToolContext> = {},
): ToolContext {
  return {
    userId: 'owner',
    chatId: 'chat',
    tenantDb,
    permissionPolicy: permissionPolicy(map),
    ...overrides,
  };
}

function fakeSsh(
  resolution: SshResolution = { outcome: 'resolved', destination: RESOLVED },
) {
  const resolve = vi.fn<SshClient['resolve']>(() =>
    Promise.resolve(resolution),
  );
  const run = vi.fn<SshClient['run']>(() =>
    Promise.resolve({
      outcome: 'failed',
      reason: 'client_missing',
      diagnostic: 'ssh is not installed',
    }),
  );
  const client: SshClient = {
    resolve,
    run,
    sshConfigText: () => undefined,
    dispose: () => undefined,
  };
  return { client, resolve, run };
}

/** A `read` tool that observes the context execution actually receives. */
function readProbe() {
  const execute = vi.fn(
    (executionContext: ToolContext, { path }: { path: string }) => ({
      status: 'success' as const,
      path,
      binding: executionContext.sshBinding,
    }),
  );
  const tool: Tool<{ path: string }> = {
    id: 'read',
    description: 'reads a locator',
    classification: 'read_only',
    inputSchema: z.strictObject({ path: z.string() }),
    execute,
  };
  return { tool, execute };
}

async function runRead(
  path: string,
  map: ToolPermissionMap,
  overrides: Partial<ToolContext> = {},
) {
  const probe = readProbe();
  const decisions: Array<unknown> = [];
  const result = await runTool(
    probe.tool,
    { path },
    context(map, {
      ...overrides,
      onDerivedDecision: (decision) => decisions.push(decision),
    }),
    5,
  );
  return { result, execute: probe.execute, decisions };
}

describe('ssh read admission', () => {
  it('refuses a submitted-text reject without resolving the destination', async () => {
    const { client, resolve } = fakeSsh();
    const { result, execute } = await runRead(
      'ssh://prod/etc/hosts',
      {
        read: {
          allow: true,
          reject: [{ field: 'path', regex: '^ssh://prod/' }],
        },
      },
      { sshClient: client },
    );

    expect(result).toMatchObject({
      status: 'error',
      type: 'permission_denied',
    });
    expect(resolve).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it('cannot let an alias go around an address reject', async () => {
    const { client, resolve } = fakeSsh({
      outcome: 'resolved',
      destination: { user: 'root', host: '10.0.0.5', port: 22 },
    });
    const { result, execute } = await runRead(
      'ssh://prod/etc/hosts',
      {
        read: {
          allow: true,
          reject: [{ field: 'path', regex: '^ssh://[^/]*@10\\.0\\.0\\.5:' }],
        },
      },
      { sshClient: client },
    );

    expect(result).toMatchObject({
      status: 'error',
      type: 'permission_denied',
    });
    expect(result.status === 'error' && result.message).toContain(
      'A reject rule matched',
    );
    expect(resolve).toHaveBeenCalledOnce();
    expect(execute).not.toHaveBeenCalled();
  });

  it('lets an all-fields reject find the resolved address', async () => {
    const { client } = fakeSsh({
      outcome: 'resolved',
      destination: { user: 'root', host: '10.0.0.5', port: 22 },
    });
    const { result, execute } = await runRead(
      'ssh://prod/etc/hosts',
      {
        read: {
          allow: true,
          reject: [{ allFields: true, regex: '10\\.0\\.0\\.5' }],
        },
      },
      { sshClient: client },
    );

    expect(result).toMatchObject({
      status: 'error',
      type: 'permission_denied',
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it('scopes an allow to its resolved host', async () => {
    const { client } = fakeSsh({
      outcome: 'resolved',
      destination: { user: 'deploy', host: 'edge-2.lan', port: 22 },
    });
    const { result, execute } = await runRead(
      'ssh://deploy@edge-2.lan/var/log/syslog',
      {
        read: {
          allow: [
            { field: 'path', regex: '^ssh://deploy@edge-1\\.lan:22/var/log/' },
          ],
        },
      },
      { sshClient: client },
    );

    expect(result).toMatchObject({
      status: 'error',
      type: 'permission_denied',
    });
    expect(result.status === 'error' && result.message).toContain(
      'No allow rule permits',
    );
    expect(execute).not.toHaveBeenCalled();
  });

  it('does not let a local allow admit a remote path', async () => {
    const { client } = fakeSsh();
    const { result, execute } = await runRead(
      'ssh://box/var/log/syslog',
      { read: { allow: [{ field: 'path', regex: '^/var/log/' }] } },
      { sshClient: client },
    );

    expect(result).toMatchObject({
      status: 'error',
      type: 'permission_denied',
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it('cannot let a %2E spelling go around a .ssh reject', async () => {
    const { client } = fakeSsh();
    const { result, execute } = await runRead(
      'ssh://box/root/%2Essh/id_ed25519',
      {
        read: {
          allow: true,
          reject: [{ field: 'path', regex: '\\.ssh' }],
        },
      },
      { sshClient: client },
    );

    expect(result).toMatchObject({
      status: 'error',
      type: 'permission_denied',
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it('keeps dot segments and binds execution to the resolved address', async () => {
    const { client, resolve } = fakeSsh();
    const { result, execute, decisions } = await runRead(
      'ssh://box/var/log/../../etc/shadow',
      {
        read: {
          allow: [{ field: 'path', regex: '^ssh://box@box:22/var/log/' }],
        },
      },
      { sshClient: client },
    );

    expect(result).toMatchObject({ status: 'success' });
    expect(resolve).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledOnce();
    const received = execute.mock.calls[0]?.[0];
    expect(received?.sshBinding).toEqual({
      destination: 'box',
      user: 'box',
      host: 'box',
      port: 22,
      locator: 'ssh://box@box:22/var/log/../../etc/shadow',
    });
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({
      kind: 'canonical',
      url: 'ssh://box@box:22/var/log/../../etc/shadow',
    });
    expect(decisions[0]).toMatchObject({
      decision: { decision: 'allow', reason: 'matched_allow' },
    });
  });

  it('resolves in bypass mode so execution can bind the address', async () => {
    const { client, resolve } = fakeSsh();
    const { result, execute } = await runRead(
      'ssh://box/etc/hostname',
      { read: { allow: true, reject: true } },
      { sshClient: client, permissionMode: 'bypass' },
    );

    expect(result).toMatchObject({ status: 'success' });
    expect(resolve).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledOnce();
    expect(execute.mock.calls[0]?.[0].sshBinding).toMatchObject({
      locator: 'ssh://box@box:22/etc/hostname',
    });
  });

  it('fails as ssh_unavailable when resolution fails', async () => {
    const { client } = fakeSsh({
      outcome: 'failed',
      reason: 'config',
      diagnostic: 'Bad configuration option',
    });
    const { result, execute } = await runRead(
      'ssh://box/etc/hostname',
      { read: { allow: true } },
      { sshClient: client },
    );

    expect(result).toMatchObject({
      status: 'error',
      type: 'ssh_unavailable',
    });
    expect(result.status === 'error' && result.message).toContain('config');
    expect(execute).not.toHaveBeenCalled();
  });

  it('passes the call signal to resolution and reports cancellation', async () => {
    const { client, resolve } = fakeSsh({ outcome: 'cancelled' });
    const controller = new AbortController();
    const { result, execute } = await runRead(
      'ssh://box/etc/hostname',
      { read: { allow: true } },
      { sshClient: client, abortSignal: controller.signal },
    );

    expect(result).toMatchObject({ status: 'error', type: 'cancelled' });
    expect(result.status === 'error' && result.message).toBe(
      'Tool "read" was cancelled.',
    );
    expect(resolve).toHaveBeenCalledWith(
      expect.objectContaining({ signal: controller.signal }),
    );
    expect(execute).not.toHaveBeenCalled();
  });

  it('resolves only the destination fields the locator wrote', async () => {
    const { client, resolve } = fakeSsh();
    const admission = await admitSshRead(
      { path: 'ssh://box/etc/hostname' },
      context({ read: { allow: true } }, { sshClient: client }),
    );

    expect(admission.kind).toBe('decided');
    expect(resolve.mock.calls[0]?.[0]).toStrictEqual({ host: 'box' });
  });

  it('passes the written user, port, and signal to resolution', async () => {
    const { client, resolve } = fakeSsh();
    const controller = new AbortController();
    const admission = await admitSshRead(
      { path: 'ssh://deploy@box:2222/etc/hostname' },
      context(
        { read: { allow: true } },
        { sshClient: client, abortSignal: controller.signal },
      ),
    );

    expect(admission.kind).toBe('decided');
    expect(resolve.mock.calls[0]?.[0]).toStrictEqual({
      host: 'box',
      user: 'deploy',
      port: 2222,
      signal: controller.signal,
    });
  });

  it('resolves an uppercase host under its lowercase spelling', async () => {
    const { client, resolve } = fakeSsh();
    const admission = await admitSshRead(
      { path: 'ssh://BOX/etc/hostname' },
      context({ read: { allow: true } }, { sshClient: client }),
    );

    expect(admission.kind).toBe('decided');
    expect(resolve.mock.calls[0]?.[0]).toStrictEqual({ host: 'box' });
  });

  it('reports no canonical decision for a locator that is already canonical', async () => {
    const { client } = fakeSsh();
    const decisions: Array<unknown> = [];
    const admission = await admitSshRead(
      { path: 'ssh://box@box:22/etc/hostname' },
      context(
        { read: { allow: true } },
        {
          sshClient: client,
          onDerivedDecision: (decision) => decisions.push(decision),
        },
      ),
    );

    expect(admission.kind).toBe('decided');
    expect(decisions).toHaveLength(0);
  });

  it('admits nothing without a trusted policy, even with the ssh section', async () => {
    const { client, resolve } = fakeSsh();
    const admission = await admitSshRead(
      { path: 'ssh://box/etc/hostname' },
      context(
        { read: { allow: true } },
        { sshClient: client, permissionPolicy: undefined },
      ),
    );

    expect(admission).toEqual({ kind: 'none' });
    expect(resolve).not.toHaveBeenCalled();
  });

  it('treats every ssh:// read as refused in the synchronous preview', () => {
    const { client } = fakeSsh();
    const probe = readProbe();
    const policy = context({ read: { allow: true } }, { sshClient: client });

    expect(
      previewToolPermission(
        probe.tool,
        { path: 'ssh://box/etc/hostname' },
        policy,
      ),
    ).toBe(false);
    expect(
      previewToolPermission(probe.tool, { path: '/etc/hostname' }, policy),
    ).toBe(true);
  });

  it('keeps ssh:// an unknown scheme without the ssh section', async () => {
    // The section is the only source of a transport, so the read reaches
    // execution with no client and no resolved binding: nothing can start an
    // ssh process for it.
    const execute = vi.fn((toolContext: ToolContext, args: { path: string }) =>
      nativeReadTool.execute(toolContext, args),
    );
    const result = await runTool(
      { ...nativeReadTool, execute },
      { path: 'ssh://box/etc/hostname' },
      context({ read: { allow: true } }),
      5,
    );

    expect(result).toEqual({
      status: 'error',
      type: 'invalid_path',
      message: 'This path scheme is not available.',
    });
    expect(execute).toHaveBeenCalledTimes(1);
    const [executionContext] = execute.mock.calls[0] ?? [];
    expect(executionContext?.sshClient).toBeUndefined();
    expect(executionContext?.sshBinding).toBeUndefined();
  });

  it('runs an admitted read through the resolved binding and its client', async () => {
    const { client, run } = fakeSsh();
    const result = await runTool(
      nativeReadTool,
      { path: 'ssh://box/etc/hostname' },
      context({ read: { allow: true } }, { sshClient: client }),
      5,
    );

    expect(result).toMatchObject({
      status: 'error',
      type: 'ssh_unavailable',
    });
    expect(result.status === 'error' && result.message).toContain(
      'client_missing',
    );
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({
        destination: 'box',
        resolved: RESOLVED,
        remoteCommand: ['sh', '-s'],
      }),
    );
  });

  it('returns invalid_path for a malformed locator before resolving', async () => {
    const { client, resolve } = fakeSsh();
    const result = await runTool(
      nativeReadTool,
      { path: 'ssh://-oProxyCommand=id/etc/hostname' },
      context({ read: { allow: true } }, { sshClient: client }),
      5,
    );

    expect(result).toMatchObject({ status: 'error', type: 'invalid_path' });
    expect(resolve).not.toHaveBeenCalled();
  });
});

describe('ssh mutations and Workspace entry', () => {
  it.each([
    [
      'edit',
      nativeEditTool,
      { path: 'ssh://box/tmp/x.txt', oldText: 'a', newText: 'b' },
    ],
    ['write', nativeWriteTool, { path: 'ssh://box/tmp/x.txt', content: 'x' }],
  ])(
    'returns unsupported_operation for %s without a process',
    async (_label, tool, args) => {
      const { client, resolve, run } = fakeSsh();
      const map: ToolPermissionMap = { [tool.id]: { allow: true } };
      const result = await runTool(
        tool,
        args,
        context(map, { sshClient: client }),
        5,
      );

      expect(result).toMatchObject({
        status: 'error',
        type: 'unsupported_operation',
      });
      expect(result.status === 'error' && result.message).toBe(
        'An ssh:// locator supports read and a bash working directory only; ' +
          'edit and write do not change remote files.',
      );
      expect(resolve).not.toHaveBeenCalled();
      expect(run).not.toHaveBeenCalled();
    },
  );

  it('keeps an unknown scheme unknown for a mutation that carries the ssh section', async () => {
    const { client, run } = fakeSsh();
    const result = await runTool(
      nativeWriteTool,
      { path: 'vault://box/tmp/x.txt', content: 'x' },
      context({ write: { allow: true } }, { sshClient: client }),
      5,
    );

    expect(result).toMatchObject({
      status: 'error',
      type: 'invalid_path',
      message: 'This path scheme is not available.',
    });
    expect(run).not.toHaveBeenCalled();
  });

  it('refuses ssh:// as a Workspace root and leaves the Chat outside it', async () => {
    const workspaceRoot: WorkspaceRootCell & { beginStep(): void } =
      createWorkspaceRootCell(undefined);
    const result = await runTool(
      enterWorkspaceTool,
      { path: 'ssh://box/srv/app' },
      context(
        { enter_workspace: { allow: true } },
        { workspaceRoot, runId: 'run', toolCallId: 'call' },
      ),
      5,
    );

    expect(result).toMatchObject({ status: 'error', type: 'invalid_path' });
    expect(result.status === 'error' && result.message).toBe(
      'An ssh:// locator cannot be a Workspace root; Workspace selects a ' +
        'local or Machine directory.',
    );
    expect(workspaceRoot.current()).toBeUndefined();
  });
});
