import path from 'node:path';

import {
  machineWorkspaceSkillSources,
  workspaceSkillSources,
} from './workspace-skill-sources';

describe('workspaceSkillSources', () => {
  it('returns the root-relative sources from lowest to highest precedence', () => {
    expect(workspaceSkillSources('/work/project')).toEqual([
      path.join('/work/project', '.claude', 'skills'),
      path.join('/work/project', '.agents', 'skills'),
      path.join('/work/project', '.llame', 'skills'),
    ]);
  });

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

  it('has no Machine sources for a root that names no path', () => {
    expect(machineWorkspaceSkillSources('/work/project')).toBeUndefined();
    expect(machineWorkspaceSkillSources('machine://devl')).toBeUndefined();
    expect(machineWorkspaceSkillSources('machine://')).toBeUndefined();
  });
});
