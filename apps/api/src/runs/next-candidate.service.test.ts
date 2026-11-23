/**
 * The pure half of the next-candidate action (model-roles D7, "The next
 * candidate follows the current model in the role", "A compaction Run does not
 * switch"): which Run the owner may move, and to which candidate.
 */

import type { Run } from '../db/schema';
import type { NextCandidate } from '../models/model-selection';
import { switchTargetFor } from './next-candidate.service';

type Switchable = Pick<Run, 'kind' | 'status' | 'selector' | 'modelId'>;

const run: Switchable = {
  kind: 'turn',
  status: 'awaiting_quota',
  selector: '@coding',
  modelId: 'system:openai:codex',
};

const NEXT: NextCandidate = {
  modelId: 'system:anthropic:sonnet',
  candidateEffort: 'low',
  paid: true,
};

/** The role's chain: `codex`, then `sonnet`, and nothing after it. */
const chain = (selector: string, currentModelId: string) =>
  selector === '@coding' && currentModelId === 'system:openai:codex'
    ? NEXT
    : undefined;

describe('switchTargetFor', () => {
  it('moves a waiting turn Run onto the candidate after its model', () => {
    expect(switchTargetFor(run, chain)).toEqual(NEXT);
  });

  it('answers undefined for an exact selector', () => {
    const exact = { ...run, selector: 'system:openai:codex' };

    expect(switchTargetFor(exact, chain)).toBeUndefined();
  });

  it('answers undefined for the last candidate', () => {
    const last = { ...run, modelId: NEXT.modelId };

    expect(switchTargetFor(last, () => undefined)).toBeUndefined();
  });

  it('answers undefined for a compaction Run', () => {
    const compaction = { ...run, kind: 'compaction' as const };

    expect(switchTargetFor(compaction, chain)).toBeUndefined();
  });

  it('answers undefined for a Run that is not in a quota wait', () => {
    const running = { ...run, status: 'running_model' as const };

    expect(switchTargetFor(running, chain)).toBeUndefined();
  });
});
