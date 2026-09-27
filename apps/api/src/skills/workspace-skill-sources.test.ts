import path from 'node:path';

import { workspaceSkillSources } from './workspace-skill-sources';

describe('workspaceSkillSources', () => {
  it('returns the root-relative sources from lowest to highest precedence', () => {
    expect(workspaceSkillSources('/work/project')).toEqual([
      path.join('/work/project', '.claude', 'skills'),
      path.join('/work/project', '.agents', 'skills'),
      path.join('/work/project', '.llame', 'skills'),
    ]);
  });
});
