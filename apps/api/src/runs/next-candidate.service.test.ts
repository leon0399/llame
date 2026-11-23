import type { NextCandidate } from '../models/model-selection';
import { effortAfterSwitch } from '../models/model-selection';

const SONNET: NextCandidate['model'] = {
  id: 'system:anthropic:sonnet',
  source: 'system',
  provider: 'anthropic',
  providerModelId: 'claude-sonnet',
  contextWindowTokens: 200_000,
  input: ['text'],
  systemPromptTemplate: 'prompt',
  systemPromptSource: 'project_default',
  referencesSkills: false,
  reasoning: {
    effortLevels: [{ value: 'low' }, { value: 'medium' }],
    defaultEffort: 'low',
    cacheInvalidatedByEffortChange: false,
  },
};

describe('the next candidate effort', () => {
  it('uses the role candidate effort when the selected effort is unsupported', () => {
    expect(
      effortAfterSwitch({
        selectedEffort: 'xhigh',
        model: SONNET,
        candidateEffort: 'medium',
      }),
    ).toEqual({ kind: 'effort', effort: 'medium' });
  });
});
