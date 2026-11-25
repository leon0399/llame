import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PROTOCOL_VERSION } from '@workspace/machine-protocol';
import { MACHINE_BINARY } from '../../testing/local-daemon';
import { createLocalChildTransportFactory } from '../local-child-transport';
import { MachineSession } from '../machine-session';

const NAME = 'git-wire-test';
const OPTIONS = { displayPrefix: `machine://${NAME}` };
const ENVELOPE = { budgetMs: 60_000 };

describe('Git wire handlers against the real daemon', () => {
  let configDir: string;
  let stateDir: string;
  let root: string;
  let repository: string;
  beforeAll(() => {
    configDir = mkdtempSync(join(tmpdir(), 'llame-git-wire-config-'));
    stateDir = mkdtempSync(join(tmpdir(), 'llame-git-wire-state-'));
    root = realpathSync(mkdtempSync(join(tmpdir(), 'llame-git-wire-root-')));
    repository = join(root, 'repo');
    execFileSync('git', ['init', '-b', 'main', repository]);
    execFileSync('git', [
      '-C',
      repository,
      'config',
      'user.email',
      'test@example.invalid',
    ]);
    execFileSync('git', [
      '-C',
      repository,
      'config',
      'user.name',
      'Git wire test',
    ]);
    writeFileSync(join(repository, 'README.md'), 'real daemon git test\n');
    execFileSync('git', ['-C', repository, 'add', 'README.md']);
    execFileSync('git', ['-C', repository, 'commit', '-m', 'initial']);
    execFileSync(MACHINE_BINARY, ['roots', 'add', root], {
      env: {
        ...process.env,
        LLAME_MACHINE_CONFIG_DIR: configDir,
        LLAME_MACHINE_STATE_DIR: stateDir,
      },
      stdio: 'pipe',
    });
  });
  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(configDir, { recursive: true, force: true });
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('inspects, reads state, and adds/lists/removes a worktree through v3', async () => {
    const factory = createLocalChildTransportFactory({
      command: MACHINE_BINARY,
      env: {
        ...process.env,
        LLAME_MACHINE_CONFIG_DIR: configDir,
        LLAME_MACHINE_STATE_DIR: stateDir,
      },
    });

    const session = new MachineSession({
      name: NAME,
      transport: factory.open({ name: NAME }),
      hubVersion: `0.0.0-${PROTOCOL_VERSION}`,
    });

    const path = `machine://${NAME}${repository}`;
    const worktreePath = join(root, 'tree');

    try {
      const inspect = await session.call('git.inspect', {
        envelope: ENVELOPE,
        path,
        options: OPTIONS,
      });

      expect(inspect).toMatchObject({
        status: 'ok',
        toplevel: path,
        linked: false,
      });

      const locate = await session.call('git.locate', {
        envelope: ENVELOPE,
        path,
        options: OPTIONS,
      });

      expect(locate).toEqual({
        status: 'ok',
        gitEntry: `${path}/.git`,
        kind: 'directory',
      });

      const state = await session.call('git.state', {
        envelope: ENVELOPE,
        path,
        gitEntry: `${path}/.git`,
        limit: 10,
        submodules: 'skip',
        options: OPTIONS,
      });

      expect(state).toMatchObject({
        status: 'ok',
        toplevel: path,
        branch: 'main',
        detached: false,
        commits: [{ subject: 'initial' }],
      });

      const added = await session.call('git.worktreeAdd', {
        envelope: ENVELOPE,
        source: path,
        branch: 'git-wire-branch',
        directory: `machine://${NAME}${worktreePath}`,
        options: OPTIONS,
      });

      expect(added).toMatchObject({
        status: 'ok',
        path: `machine://${NAME}${worktreePath}`,
        branch: 'git-wire-branch',
      });

      const listed = await session.call('git.worktreeList', {
        envelope: ENVELOPE,
        source: path,
        options: OPTIONS,
      });

      expect(
        listed.status === 'ok' &&
          listed.worktrees.some(
            (worktree) =>
              worktree.path === `machine://${NAME}${worktreePath}` &&
              worktree.branch === 'git-wire-branch',
          ),
      ).toBe(true);

      const removed = await session.call('git.worktreeRemove', {
        envelope: ENVELOPE,
        path: `machine://${NAME}${worktreePath}`,
        options: OPTIONS,
      });

      expect(removed).toEqual({ status: 'ok' });
    } finally {
      session.close();
    }
  });
});
