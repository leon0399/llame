import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { NotFoundException } from '@nestjs/common';

import { type Chat } from '../db/schema';
import { GitSnapshotService } from '../git-state/git-snapshot.service';
import {
  BUILT_IN_DEFAULTS,
  type LlameConfig,
} from '../instance-config/llame-config';
import {
  ExecutorGit,
  localGitSurface,
  type ExecutorTarget,
} from '../machines/executor-git.service';
import { MachineConnector } from '../machines/machine-connector.service';
import { createProtocolPeer } from '../testing/machine-protocol-peer';
import { ChatGitStateService } from './chat-git-state.service';

for (const name of execFileSync('git', ['rev-parse', '--local-env-vars'])
  .toString()
  .split('\n')) {
  if (name !== '') delete process.env[name];
}

const OWNER = 'owner-1';
const CHAT_ID = '0b6f5499-dde4-43cf-89fe-037998a0fe64';
const EXECUTOR = 'route-host';

const created: Array<string> = [];
const connectors: Array<MachineConnector> = [];

afterEach(() => {
  for (const connector of connectors.splice(0)) connector.onModuleDestroy();
  for (const directory of created.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function runGit(cwd: string, args: ReadonlyArray<string>): string {
  return execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null' },
  });
}

function repository(): string {
  const base = mkdtempSync(join(tmpdir(), 'chat-git-state-'));
  created.push(base);
  const directory = join(realpathSync(base), 'llame');
  mkdirSync(directory);
  runGit(directory, ['init', '--quiet', '--initial-branch=main', '.']);
  runGit(directory, ['config', 'user.name', 'llame tests']);
  runGit(directory, ['config', 'user.email', 'llame@test.invalid']);
  writeFileSync(join(directory, 'README.md'), 'readme\n');
  runGit(directory, ['add', '.']);
  runGit(directory, ['commit', '--quiet', '--message', 'first commit']);
  return directory;
}

function chatAt(
  workspaceRoot: string | null,
  workspaceExecutorId: string | null = EXECUTOR,
): Chat {
  return {
    id: CHAT_ID,
    ownerUserId: OWNER,
    title: null,
    visibility: 'private',
    createdAt: new Date(0),
    updatedAt: new Date(0),
    archivedAt: null,
    projectId: null,
    recencyDigestBaseline: null,
    recencyDigestTold: null,
    recencyDigestRebakedFrom: null,
    skillCatalogBaseline: null,
    skillCatalogRebakedFrom: null,
    skillCatalogTold: null,
    workspaceRoot,
    workspaceExecutorId,
    workspaceGeneration: 1,
    artifactSeq: 0,
    workspaceTold: null,
    workspaceToldFrom: null,
    workspaceToldAvailable: null,
    workspaceDetachReason: null,
  };
}

function realExecutors(): ExecutorGit {
  const connector = new MachineConnector({
    hubVersion: 'test-hub',
    machines: undefined,
    transportFactory: createProtocolPeer().factory,
    idleCloseMs: 1000,
  });
  connectors.push(connector);
  const config: LlameConfig = {
    ...BUILT_IN_DEFAULTS,
    tools: { ...BUILT_IN_DEFAULTS.tools, nativeExecutorId: EXECUTOR },
  };
  return new ExecutorGit({ config }, connector, localGitSurface());
}

function serviceFor(
  chat: Chat | undefined,
  executors: Pick<ExecutorGit, 'locate'> &
    Pick<ExecutorGit, 'locateEntry' | 'state'>,
  reachable = vi.fn<MachineConnector['reachable']>(),
) {
  const getChatById = vi
    .fn<(id: string, owner: string) => Promise<Chat | undefined>>()
    .mockResolvedValue(chat);
  const service = new ChatGitStateService(
    { getChatById },
    new GitSnapshotService(executors),
    executors,
    { reachable },
  );
  return { service, getChatById, reachable };
}

describe('ChatGitStateService', () => {
  it('shows a branch switch at once', async () => {
    const root = repository();
    const { service } = serviceFor(chatAt(root), realExecutors());

    const before = await service.read(CHAT_ID, OWNER);
    runGit(root, ['switch', '--quiet', '--create', 'feature/x']);
    const after = await service.read(CHAT_ID, OWNER);

    expect(before).toMatchObject({ status: 'ok', branch: 'main' });
    expect(after).toMatchObject({ status: 'ok', branch: 'feature/x' });
  });

  it('reports a normalized remote and never the raw URL', async () => {
    const root = repository();
    runGit(root, [
      'remote',
      'add',
      'origin',
      'https://x-access-token:ghp_secret@github.com/leon0399/llame.git',
    ]);
    const { service } = serviceFor(chatAt(root), realExecutors());

    const state = await service.read(CHAT_ID, OWNER);

    expect(state).toMatchObject({
      status: 'ok',
      remotes: [{ name: 'origin', value: 'github.com/leon0399/llame' }],
    });
    expect(JSON.stringify(state)).not.toContain('ghp_secret');
  });

  it('does not let tool permissions gate the entry', async () => {
    const root = repository();
    const executors = realExecutors();
    const observe = vi.spyOn(GitSnapshotService.prototype, 'observe');
    const { service } = serviceFor(chatAt(root), executors);

    const state = await service.read(CHAT_ID, OWNER);

    expect(state.status).toBe('ok');
    const [input] = observe.mock.calls[0] ?? [];
    expect(input?.admit(join(root, '.git'))).toBe(true);
    observe.mockRestore();
  });

  it('answers a Chat that is not a repository with its line', async () => {
    const base = mkdtempSync(join(tmpdir(), 'chat-git-state-plain-'));
    created.push(base);
    const { service } = serviceFor(chatAt(realpathSync(base)), realExecutors());

    await expect(service.read(CHAT_ID, OWNER)).resolves.toEqual({
      status: 'not_a_repository',
      line: 'not a git repository',
    });
  });

  it('has no git state for an unbound Chat', async () => {
    const executors = realExecutors();
    const locate = vi.spyOn(executors, 'locate');
    const { service } = serviceFor(chatAt(null, null), executors);

    await expect(service.read(CHAT_ID, OWNER)).resolves.toEqual({
      status: 'unbound',
    });
    expect(locate).not.toHaveBeenCalled();
  });

  it('is unavailable for a binding on another executor, with no git call', async () => {
    const executors = realExecutors();
    const locateEntry = vi.spyOn(executors, 'locateEntry');
    const state = vi.spyOn(executors, 'state');
    const { service } = serviceFor(
      chatAt(repository(), 'some-other-host'),
      executors,
    );

    await expect(service.read(CHAT_ID, OWNER)).resolves.toEqual({
      status: 'unavailable',
      reason: 'executor_unavailable',
      line: 'git state unavailable: executor unavailable',
    });
    expect(locateEntry).not.toHaveBeenCalled();
    expect(state).not.toHaveBeenCalled();
  });

  it('is not found for a Chat the owner does not hold, with no git call', async () => {
    const executors = realExecutors();
    const locate = vi.spyOn(executors, 'locate');
    const { service, getChatById } = serviceFor(undefined, executors);

    await expect(service.read(CHAT_ID, OWNER)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(getChatById).toHaveBeenCalledWith(CHAT_ID, OWNER);
    expect(locate).not.toHaveBeenCalled();
  });

  it('asks a Machine root for reachability under its own key', async () => {
    const executors = realExecutors();
    const target: ExecutorTarget = {
      executorId: 'machine:nas',
      machine: 'nas',
      path: '/srv/repo',
    };
    vi.spyOn(executors, 'locate').mockReturnValue(target);
    const locateEntry = vi.spyOn(executors, 'locateEntry');
    const reachable = vi.fn().mockResolvedValue(false);
    const { service } = serviceFor(
      chatAt('machine://nas/srv/repo', 'machine:nas'),
      executors,
      reachable,
    );

    await expect(service.read(CHAT_ID, OWNER)).resolves.toMatchObject({
      status: 'unavailable',
      reason: 'machine_unavailable',
    });
    expect(reachable).toHaveBeenCalledExactlyOnceWith(
      'nas',
      expect.stringMatching(/^route:[0-9a-f-]{36}$/),
    );
    expect(locateEntry).not.toHaveBeenCalled();
  });
});
