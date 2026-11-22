import path from 'node:path';

import {
  machineWorkspaceSkillSources,
  workspaceSkillSources,
} from './workspace-skill-sources';

describe('workspaceSkillSources', () => {
  it('returns Machine locators for a Machine path root', () => {
    expect(workspaceSkillSources('machine://devl/home/me/shop')).toEqual([
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
    expect(workspaceSkillSources('machine://devl/home/me/shop/')).toEqual([
      'machine://devl/home/me/shop/.claude/skills',
      'machine://devl/home/me/shop/.agents/skills',
      'machine://devl/home/me/shop/.llame/skills',
    ]);
  });

  it('names this process’s own Machine by its locators too', () => {
    // The host Machine is an ordinary Machine: its sources are locators the
    // attempt's snapshot fills over its daemon, never host paths.
    expect(workspaceSkillSources('machine://host-a/work/project')).toEqual([
      'machine://host-a/work/project/.claude/skills',
      'machine://host-a/work/project/.agents/skills',
      'machine://host-a/work/project/.llame/skills',
    ]);
  });

  it('has no sources for a root that names no Machine path', () => {
    expect(machineWorkspaceSkillSources('/work/project')).toBeUndefined();
    expect(machineWorkspaceSkillSources('machine://devl')).toBeUndefined();
    expect(machineWorkspaceSkillSources('machine://')).toBeUndefined();
    expect(workspaceSkillSources('/work/project')).toEqual([]);
    expect(workspaceSkillSources('machine://devl')).toEqual([]);
    expect(workspaceSkillSources('machine://')).toEqual([]);
  });

  it('contributes nothing for a root the locator grammar refuses', () => {
    expect(workspaceSkillSources('machine://BAD NAME/home/me/shop')).toEqual(
      [],
    );
    expect(workspaceSkillSources('machine:/devl/home/me/shop')).toEqual([]);
  });

  it('derives each source inside the root it was given', () => {
    const [claude, agents, llame] =
      machineWorkspaceSkillSources('machine://devl/srv/app') ?? [];

    expect(path.posix.dirname(claude.path)).toBe('/srv/app/.claude');
    expect(path.posix.dirname(agents.path)).toBe('/srv/app/.agents');
    expect(path.posix.dirname(llame.path)).toBe('/srv/app/.llame');
  });
});
