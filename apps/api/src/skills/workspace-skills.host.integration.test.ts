/**
 * Host Workspace skills through the host Machine's real daemon (host-as-machine
 * design D8, D12; remote-machines "Host Workspace skills come from the host
 * Machine daemon"): preparation snapshots the Workspace's three skill sources
 * from the built `llame-machine` child and installs a catalog whose Machine
 * reads come from that snapshot, while an operator's own directories stay host
 * paths read in process.
 */

import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { type SkillCatalogPort } from './skill-catalog';
import { prepareMachineSkills } from '../runs/machine-workspace';
import { withLocalDaemon } from '../testing/local-daemon';
import { workspaceSkillSources } from './workspace-skill-sources';

/** Write one skill package's `SKILL.md` below `source`. */
async function writeSkill(
  source: string,
  name: string,
  description: string,
): Promise<void> {
  const document = join(source, name, 'SKILL.md');

  await mkdir(dirname(document), { recursive: true });
  await writeFile(
    document,
    `---\nname: ${name}\ndescription: ${description}\n---\n# ${name}\n`,
  );
}

/** The catalog preparation installed for `root`, failing loudly when none did. */
function installedCatalog(
  catalogs: Map<string, SkillCatalogPort>,
  root: string,
): SkillCatalogPort {
  const catalog = catalogs.get(root);

  if (catalog === undefined) {
    throw new Error('preparation installed no catalog for the root');
  }

  return catalog;
}

describe('host Workspace skills through the daemon', () => {
  it('reads the host Workspace’s skills through its daemon', async () => {
    const root = await realpath(
      await mkdtemp(join(tmpdir(), 'skills-host-daemon-')),
    );

    try {
      const source = join(root, '.agents', 'skills');

      await writeSkill(source, 'deploy', 'Deploy the app');

      await withLocalDaemon([root], async (daemon) => {
        const catalogs = new Map<string, SkillCatalogPort>();
        const workspace = daemon.locator(root);

        await prepareMachineSkills(catalogs, {
          connector: daemon.connector,
          machineName: daemon.name,
          root: workspace,
          toolAllowlist: ['read'],
          skillDirectories: [],
        });

        const snapshot = installedCatalog(catalogs, workspace).getSnapshot(
          workspaceSkillSources(workspace),
        );

        expect(snapshot.available).toBe(true);
        expect(snapshot.entries).toEqual([
          expect.objectContaining({
            name: 'deploy',
            description: 'Deploy the app',
            available: true,
            sourceDirectory: daemon.locator(source),
            skillDirectory: daemon.locator(join(source, 'deploy')),
          }),
        ]);
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('keeps operator skill directories in process', async () => {
    const root = await realpath(
      await mkdtemp(join(tmpdir(), 'skills-host-workspace-')),
    );

    const operator = await realpath(
      await mkdtemp(join(tmpdir(), 'skills-host-operator-')),
    );

    try {
      await writeSkill(join(root, '.llame', 'skills'), 'release', 'Ship it');
      await writeSkill(operator, 'review', 'Review a diff');

      await withLocalDaemon([root], async (daemon) => {
        const catalogs = new Map<string, SkillCatalogPort>();
        const workspace = daemon.locator(root);

        await prepareMachineSkills(catalogs, {
          connector: daemon.connector,
          machineName: daemon.name,
          root: workspace,
          toolAllowlist: ['read'],
          skillDirectories: [operator],
        });

        const snapshot = installedCatalog(catalogs, workspace).getSnapshot(
          workspaceSkillSources(workspace),
        );

        expect(snapshot.entries).toEqual([
          expect.objectContaining({
            name: 'release',
            sourceDirectory: daemon.locator(join(root, '.llame', 'skills')),
          }),
          expect.objectContaining({
            name: 'review',
            sourceDirectory: operator,
          }),
        ]);
      });
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(operator, { recursive: true, force: true });
    }
  });
});
