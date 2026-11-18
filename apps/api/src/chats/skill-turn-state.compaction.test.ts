import type { Chat } from '../db/schema';
import type {
  SkillCatalogEntry,
  SkillCatalogSnapshot,
} from '../skills/skill-catalog';
import { asDouble } from '../testing/support';
import { resolveTurnSkillState } from './skill-turn-state';

it('the next turn starts a skill epoch with its Workspace skills', () => {
  const workspaceRoot = '/workspace/project';
  const workspaceSkills = `${workspaceRoot}/.agents/skills`;

  const skill: SkillCatalogEntry = {
    name: 'deploy',
    description: 'Deploy this project',
    proactive: true,
    sourceDirectory: workspaceSkills,
    skillDirectory: `${workspaceSkills}/deploy`,
    available: true,
    diagnostics: [],
  };

  const catalog = {
    getSnapshot: vi.fn((): SkillCatalogSnapshot => ({
      available: true,
      directories: [workspaceSkills],
      entries: [skill],
      diagnostics: [],
    })),
  };

  const chat = asDouble<Chat>({
    skillCatalogBaseline: {
      entries: [{ name: 'old-skill', description: 'old epoch' }],
      omitted: 0,
    },
    skillCatalogRebakedFrom: 'previous-checkpoint',
    workspaceRoot,
  });

  const extraSources = [workspaceSkills];

  const state = resolveTurnSkillState(
    {
      skillCatalog: catalog,
      skillDirectories: ['/operator/skills'],
      extraSources,
    },
    {
      chat,
      runId: 'next-turn',
      latestCheckpointId: 'new-checkpoint',
      modelReferencesSkills: true,
    },
  );

  expect(catalog.getSnapshot).toHaveBeenCalledWith(extraSources);
  expect(state.freeze?.rebakedFrom).toBe('new-checkpoint');
  expect(state.freeze?.baseline.entries).toEqual([
    { name: 'deploy', description: 'Deploy this project' },
  ]);
});
