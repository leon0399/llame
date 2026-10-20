/**
 * `read` over `ssh://` against the sshd fixture (ssh-locator tasks 4.3 and
 * 4.4). The hub side is the production path end to end: the real `runTool`
 * admission resolves the destination through `ssh -G`, permission decides on
 * the resolved locator, and the read spawns the system `ssh` with the generated
 * safety block plus the included configuration.
 *
 * The box is reached through the bastion alias the include declares, with a
 * plain-login key; a second container is the same image with `bash` removed;
 * and every file case is a root-created entry the box account's own permissions
 * decide. Requires a Docker daemon and the OpenSSH client tools; the fixture
 * fails loudly when either is missing.
 */

import { type StartedTestContainer } from 'testcontainers';

import {
  MACHINE_SSHD_FIXTURE_ROOT,
  MACHINE_SSHD_LOGIN_NOISE,
  MACHINE_SSHD_SH_ALIAS,
  MACHINE_SSHD_NOTES_CONTENT,
  startMachineSshd,
  type MachineSshd,
} from '../testing/machine-sshd/machine-sshd';
import { createSshClient, type SshClient } from './ssh-client';

import { type TenantRunner } from '../db/tenant-db.service';
import { nativeReadTool } from '../tools/native-files';
import { compileToolPermissionMap } from '../tools/permissions/compile-permissions';
import { runTool } from '../tools/runner';
import { type ToolContext } from '../tools/types';
import { createWorkspaceRootCell } from '../tools/workspace-path';

const FIXTURE = MACHINE_SSHD_FIXTURE_ROOT;

/** The call budget: enough for the containers' first SSH handshake. */
const CALL_TIMEOUT_SECONDS = 30;

const tenantDb: TenantRunner = {
  runAs: () =>
    Promise.reject(new Error('an ssh read records no native attempt')),
};

const policy = compileToolPermissionMap(
  { read: { allow: true } },
  'test-policy',
);

describe('ssh reads over a real sshd', () => {
  let fixture: MachineSshd;
  const clients: Array<SshClient> = [];

  beforeAll(async () => {
    fixture = await startMachineSshd();
  }, 600_000);

  afterAll(async () => {
    for (const client of clients) client.dispose();
    await fixture.dispose();
  });

  function client(options: Parameters<MachineSshd['ssh']>[0] = {}): SshClient {
    const connection = fixture.ssh(options);
    const created = createSshClient({
      ssh: {
        knownHostsFile: connection.knownHostsFile,
        identityFile: connection.identityFile,
        configFile: connection.includeFile,
      },
    });
    clients.push(created);
    return created;
  }

  function context(
    sshClient: SshClient,
    overrides: Partial<ToolContext> = {},
  ): ToolContext {
    return {
      userId: 'owner',
      chatId: 'chat',
      tenantDb,
      permissionPolicy: policy,
      sshClient,
      ...overrides,
    };
  }

  function read(
    path: string,
    sshClient: SshClient,
    overrides: Partial<ToolContext> = {},
  ) {
    return runTool(
      nativeReadTool,
      { path },
      context(sshClient, overrides),
      CALL_TIMEOUT_SECONDS,
    );
  }

  async function hostnameOf(container: StartedTestContainer): Promise<string> {
    const result = await fixture.execIn(container, ['hostname']);
    return result.stdout.trim();
  }

  it('reads a file with a selector, numbered as a local read numbers it', async () => {
    const result = await read(`ssh://box${FIXTURE}/lines.txt:2-3`, client());

    expect(result).toMatchObject({
      status: 'success',
      kind: 'file',
      path: `ssh://box${FIXTURE}/lines.txt`,
      requestedRange: { startLine: 2, endLine: 3 },
    });
    expect(result['content']).toContain('2: two');
    expect(result['content']).toContain('3: three');
  });

  it('excludes login-shell startup output from the file content', async () => {
    const result = await read(`ssh://box${FIXTURE}/../notes.txt`, client());

    expect(result).toMatchObject({ status: 'success', kind: 'file' });
    expect(result['content']).toContain(MACHINE_SSHD_NOTES_CONTENT.trim());
    expect(result['content']).not.toContain(MACHINE_SSHD_LOGIN_NOISE);
  });

  it('refuses the 2 MiB file at the 1 MiB bound', async () => {
    const result = await read(`ssh://box${FIXTURE}/big.txt`, client());

    expect(result).toMatchObject({ status: 'error', type: 'file_too_large' });
    expect(result.status === 'error' && result.message).toContain('1 MiB');
    expect(result.status === 'error' && result.message).toContain('bash');
  });

  it('refuses the binary file as invalid_utf8', async () => {
    const result = await read('ssh://box/usr/bin/ls', client());

    expect(result).toMatchObject({ status: 'error', type: 'invalid_utf8' });
  });

  it('refuses a FIFO without opening it', async () => {
    const result = await read(`ssh://box${FIXTURE}/fifo`, client());

    expect(result).toMatchObject({
      status: 'error',
      type: 'not_regular_file',
    });
  });

  it('reports a missing path as not_found', async () => {
    const result = await read(`ssh://box${FIXTURE}/nope.txt`, client());

    expect(result).toMatchObject({ status: 'error', type: 'not_found' });
  });

  it('reads an empty file and a symlink to a file', async () => {
    const empty = await read(`ssh://box${FIXTURE}/empty.txt`, client());
    expect(empty).toMatchObject({ status: 'success', kind: 'file' });
    expect(empty['content']).toBe('');

    const link = await read(`ssh://box${FIXTURE}/link.txt`, client());
    expect(link).toMatchObject({ status: 'success', kind: 'file' });
    expect(link['content']).toContain('symlink target');
  });

  it('refuses a file and a directory the login user cannot read', async () => {
    const sshClient = client();

    const file = await read(`ssh://box${FIXTURE}/secret.txt`, sshClient);
    expect(file).toMatchObject({
      status: 'error',
      type: 'executor_unavailable',
    });
    expect(file.status === 'error' && file.message).toBe(
      'File could not be read.',
    );

    const directory = await read(`ssh://box${FIXTURE}/root-only`, sshClient);
    expect(directory).toMatchObject({
      status: 'error',
      type: 'executor_unavailable',
    });
  });

  it('lists a directory in the local form, hidden entries included', async () => {
    const result = await read(`ssh://box${FIXTURE}`, client());

    expect(result).toMatchObject({
      status: 'success',
      kind: 'directory',
      path: `ssh://box${FIXTURE}`,
    });
    const lines = String(result['content']).split('\n');
    expect(lines[0]).toBe(`ssh://box${FIXTURE}`);
    expect(lines).toContain('  - .hidden.txt');
    expect(lines).toContain('  - empty-dir/');
    expect(lines).toContain('  - link.txt@');
    // No link target: the target is a host path the model did not address.
    expect(String(result['content'])).not.toContain('->');
  });

  it('bounds a 1,500-entry directory and says there are more entries', async () => {
    const result = await read(`ssh://box${FIXTURE}/many`, client());

    expect(result).toMatchObject({ status: 'success', kind: 'directory' });
    expect(result['truncated']).toBe(true);
    expect(result['content']).toContain('more entries exist');
    expect(String(result['content']).match(/- f\d+/gu)).toHaveLength(1000);
  });

  it('keeps a name with a newline one entry', async () => {
    const result = await read(`ssh://box${FIXTURE}`, client());

    const entries = String(result['content'])
      .split('\n')
      .filter((line) => line.startsWith('  - '));
    expect(result['truncated']).toBe(false);
    expect(entries).toHaveLength(12);
    expect(String(result['content'])).toContain('  - line\nbreak.txt');
  });

  it('shows an empty directory as the local one does', async () => {
    const result = await read(`ssh://box${FIXTURE}/empty-dir`, client());

    expect(result['content']).toBe(
      `ssh://box${FIXTURE}/empty-dir\n(empty directory)\n`,
    );
  });

  it('refuses a host key missing from the pinned file', async () => {
    const result = await read(
      'ssh://box/etc/hostname',
      client({ pinBox: false }),
    );

    expect(result).toMatchObject({ status: 'error', type: 'ssh_unavailable' });
    expect(result.status === 'error' && result.message).toContain(
      'host_key_mismatch',
    );
  });

  it('keeps strict host-key checking over an included accept-new', async () => {
    const result = await read(
      'ssh://box/etc/hostname',
      client({ pinBox: false, weaken: true }),
    );

    expect(result).toMatchObject({ status: 'error', type: 'ssh_unavailable' });
    expect(result.status === 'error' && result.message).toContain(
      'host_key_mismatch',
    );
  });

  it('reports a refused key as auth_failed', async () => {
    const result = await read(
      'ssh://box/etc/hostname',
      client({ identityFile: fixture.rejectedKeyFile }),
    );

    expect(result).toMatchObject({ status: 'error', type: 'ssh_unavailable' });
    expect(result.status === 'error' && result.message).toContain(
      'auth_failed',
    );
  });

  it('reads through the bastion alias the include declares', async () => {
    const result = await read('ssh://box/etc/hostname', client());

    expect(result).toMatchObject({ status: 'success', kind: 'file' });
    expect(result['content']).toContain(await hostnameOf(fixture.box));
  });

  it('reads on the sh-only host, which has no bash', async () => {
    const result = await read(
      `ssh://${MACHINE_SSHD_SH_ALIAS}/etc/hostname`,
      client(),
    );

    expect(result).toMatchObject({ status: 'success', kind: 'file' });
    expect(result['content']).toContain(await hostnameOf(fixture.shBox));
    const bash = await fixture.shBox.exec(['sh', '-c', 'command -v bash']);
    expect(bash.exitCode).not.toBe(0);
  });

  it('lets two users read the same host', async () => {
    const sshClient = client();
    const path = `ssh://box${FIXTURE}/lines.txt`;

    const first = await read(path, sshClient, { userId: 'user-a' });
    const second = await read(path, sshClient, {
      userId: 'user-b',
      chatId: 'chat-b',
    });

    expect(first).toMatchObject({ status: 'success', kind: 'file' });
    expect(second).toMatchObject({ status: 'success', kind: 'file' });
    expect(second['content']).toEqual(first['content']);
  });

  it('reads an explicit ssh locator inside a Machine Workspace', async () => {
    const result = await read('ssh://box/etc/hostname', client(), {
      workspaceRoot: createWorkspaceRootCell('machine://devl/home/box/work'),
    });

    expect(result).toMatchObject({
      status: 'success',
      kind: 'file',
      path: 'ssh://box/etc/hostname',
    });
    expect(result['content']).toContain(await hostnameOf(fixture.box));
  });
});
