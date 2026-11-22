import path from 'node:path';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { NODE_SKILL_FILE_SYSTEM, SkillCatalog } from './skill-catalog';
import {
  machineWorkspaceSkillSources,
  verifiedWorkspaceSkillSources,
  workspaceSkillSources,
} from './workspace-skill-sources';

describe('workspaceSkillSources', () => {
  it('returns the root-relative sources from lowest to highest precedence', () => {
    expect(
      workspaceSkillSources('/work/project', { localVerified: true }),
    ).toEqual([
      path.join('/work/project', '.claude', 'skills'),
      path.join('/work/project', '.agents', 'skills'),
      path.join('/work/project', '.llame', 'skills'),
    ]);
  });

  it('returns Machine locators for a Machine path root', () => {
    expect(
      workspaceSkillSources('machine://devl/home/me/shop', {
        localVerified: false,
      }),
    ).toEqual([
      'machine://devl/home/me/shop/.claude/skills',
      'machine://devl/home/me/shop/.agents/skills',
      'machine://devl/home/me/shop/.llame/skills',
    ]);
  });

  it('canonicalizes the scheme and the Machine name', () => {
    expect(
      machineWorkspaceSkillSources('MACHINE://DEVL/home/me/my%20shop'),
    ).toEqual([
      {
        name: 'devl',
        path: '/home/me/my shop/.claude/skills',
        locator: 'machine://devl/home/me/my shop/.claude/skills',
      },
      {
        name: 'devl',
        path: '/home/me/my shop/.agents/skills',
        locator: 'machine://devl/home/me/my shop/.agents/skills',
      },
      {
        name: 'devl',
        path: '/home/me/my shop/.llame/skills',
        locator: 'machine://devl/home/me/my shop/.llame/skills',
      },
    ]);
    expect(
      workspaceSkillSources('machine://devl/home/me/shop/', {
        localVerified: false,
      }),
    ).toEqual([
      'machine://devl/home/me/shop/.claude/skills',
      'machine://devl/home/me/shop/.agents/skills',
      'machine://devl/home/me/shop/.llame/skills',
    ]);
  });

  it('has no Machine sources for a root that names no path', () => {
    expect(machineWorkspaceSkillSources('/work/project')).toBeUndefined();
    expect(machineWorkspaceSkillSources('machine://devl')).toBeUndefined();
    expect(machineWorkspaceSkillSources('machine://')).toBeUndefined();
  });

  it('treats a root that claims no Machine scheme as a host root', () => {
    for (const root of ['/work/project', 'machine:/devl/home/me/shop']) {
      expect(machineWorkspaceSkillSources(root)).toBeUndefined();
      expect(workspaceSkillSources(root, { localVerified: true })).toEqual([
        path.join(root, '.claude', 'skills'),
        path.join(root, '.agents', 'skills'),
        path.join(root, '.llame', 'skills'),
      ]);
    }
  });

  it('contributes nothing for a root the locator grammar refuses', () => {
    expect(
      workspaceSkillSources('machine://BAD NAME/home/me/shop', {
        localVerified: true,
      }),
    ).toEqual([]);
  });

  it('returns no host paths until the local Machine verifies', () => {
    expect(
      workspaceSkillSources('/work/project', { localVerified: false }),
    ).toEqual([]);
    expect(
      workspaceSkillSources('machine://host-a/work/project', {
        localMachine: 'host-a',
        localVerified: false,
      }),
    ).toEqual([]);
    expect(
      workspaceSkillSources('machine://host-a/work/project', {
        localMachine: 'host-a',
        localVerified: true,
      }),
    ).toEqual([
      path.posix.join('/work/project', '.claude', 'skills'),
      path.posix.join('/work/project', '.agents', 'skills'),
      path.posix.join('/work/project', '.llame', 'skills'),
    ]);
  });

  it('keeps a remote Machine’s locators regardless of the local verification', () => {
    expect(
      workspaceSkillSources('machine://devl/work/project', {
        localMachine: 'host-a',
        localVerified: false,
      }),
    ).toEqual([
      'machine://devl/work/project/.claude/skills',
      'machine://devl/work/project/.agents/skills',
      'machine://devl/work/project/.llame/skills',
    ]);
  });

  it('returns no source when the local handshake refuses', async () => {
    const verifyLocal = vi.fn(() => Promise.resolve(false));

    await expect(
      verifiedWorkspaceSkillSources('machine://host-a/work/project', {
        localMachine: 'host-a',
        verifyLocal,
      }),
    ).resolves.toEqual([]);
    await expect(
      verifiedWorkspaceSkillSources('/work/project', { verifyLocal }),
    ).resolves.toEqual([]);
    expect(verifyLocal).toHaveBeenCalledTimes(2);
  });

  it('verifies the local Machine only for a root it hosts', async () => {
    const verifyLocal = vi.fn(() => Promise.resolve(false));

    await expect(
      verifiedWorkspaceSkillSources('machine://devl/work/project', {
        localMachine: 'host-a',
        verifyLocal,
      }),
    ).resolves.toEqual([
      'machine://devl/work/project/.claude/skills',
      'machine://devl/work/project/.agents/skills',
      'machine://devl/work/project/.llame/skills',
    ]);
    expect(verifyLocal).not.toHaveBeenCalled();
  });

  it('reads a root on this process’s Machine from the host filesystem', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'llame-local-skills-'));
    const packageDirectory = path.join(root, '.agents', 'skills', 'deploy');
    mkdirSync(packageDirectory, { recursive: true });
    writeFileSync(
      path.join(packageDirectory, 'SKILL.md'),
      '---\nname: deploy\ndescription: Ship the service.\n---\n# Runbook\n',
    );

    try {
      const sources = workspaceSkillSources(`machine://host-a${root}`, {
        localMachine: 'host-a',
        localVerified: true,
      });

      // The sources are the plain host paths the catalog already reads, so no
      // Machine snapshot is taken for a Machine this process hosts.
      expect(sources).toEqual([
        path.join(root, '.claude', 'skills'),
        path.join(root, '.agents', 'skills'),
        path.join(root, '.llame', 'skills'),
      ]);

      const snapshot = new SkillCatalog([], NODE_SKILL_FILE_SYSTEM).getSnapshot(
        sources,
      );

      expect(snapshot.available).toBe(true);
      expect(snapshot.entries.map((entry) => entry.name)).toEqual(['deploy']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
