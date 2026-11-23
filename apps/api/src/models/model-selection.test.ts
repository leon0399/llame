/**
 * The fallback hold, unit-tested through the resolver every admission shares
 * (`resolveSelectionFromCatalog`): which model a request resolves to, the
 * effort it takes, and the selection the resulting write stores. The catalogue
 * is local, so each scenario states the role, candidates, and declared levels
 * it needs. See OpenSpec `model-roles`: "The Chat returns to the primary after
 * revertAt", "An owner pick clears the hold", "An omitted effort follows one
 * order", and "Other Run creators do not write the owner's choice".
 */

import type { ModelRoleConfig } from '../instance-config/model-roles-config';
import type { ModelReasoning, SystemModelCatalogEntry } from './model-catalog';
import type {
  ChatModelSelection,
  SelectionCatalog,
  SelectionRequest,
  SelectionWriter,
} from './model-selection';
import { effortAfterSwitch } from './model-selection';
import {
  EffortNotAvailableError,
  resolveSelectionFromCatalog,
} from './models.service';

const LEVELS: ModelReasoning = {
  effortLevels: [{ value: 'low' }, { value: 'high' }],
  defaultEffort: 'low',
  cacheInvalidatedByEffortChange: false,
};

function model(
  id: string,
  reasoning?: ModelReasoning,
): SystemModelCatalogEntry {
  return {
    id,
    source: 'system',
    provider: 'openai',
    providerModelId: id,
    contextWindowTokens: 128_000,
    input: ['text'],
    systemPromptTemplate: `Internal prompt for ${id}`,
    systemPromptSource: 'project_default',
    referencesSkills: false,
    ...(reasoning !== undefined && { reasoning }),
  };
}

/** The primary declares `low`/`high`; the held fallback declares `low`/`xhigh`. */
const CODEX = model('codex', LEVELS);

const SONNET = model('sonnet', {
  effortLevels: [{ value: 'low' }, { value: 'xhigh' }],
  defaultEffort: 'low',
  cacheInvalidatedByEffortChange: false,
});

const FAST = model('fast');

const ROLES: ReadonlyArray<ModelRoleConfig> = [
  {
    name: 'coding',
    candidates: [{ modelId: 'codex', effort: 'high' }, { modelId: 'sonnet' }],
  },
  { name: 'fast', candidates: [{ modelId: 'fast' }] },
];

const MODELS = new Map([
  [CODEX.id, CODEX],
  [SONNET.id, SONNET],
  [FAST.id, FAST],
]);

const CATALOG: SelectionCatalog = {
  defaultSelector: CODEX.id,
  roleCandidates: (roleName) =>
    ROLES.find((role) => role.name === roleName)?.candidates,
  model: (modelId) => MODELS.get(modelId),
};

/** The hold a switched `@coding` Chat stores: `sonnet` until 14:00. */
const HOLD = {
  selector: '@coding',
  modelId: SONNET.id,
  effort: 'low',
  revertAt: '2026-11-23T14:00:00.000Z',
} as const;

const STORED: ChatModelSelection = {
  revision: 2,
  selector: '@coding',
  effort: 'high',
  hold: HOLD,
};

/** Before the hold passes. */
const BEFORE = new Date('2026-11-23T13:00:00.000Z');

/** After it did. */
const AFTER = new Date('2026-11-23T14:05:00.000Z');

function resolve(
  stored: ChatModelSelection | null,
  request: SelectionRequest,
  writer: SelectionWriter,
  now: Date,
) {
  return resolveSelectionFromCatalog(CATALOG, { stored, request, writer, now });
}

/** A job notice's recorded effort is named except when a hold applies. */
function resolveNotice(
  stored: ChatModelSelection | null,
  request: SelectionRequest,
  now: Date,
) {
  return resolve(
    stored,
    { ...request, effortPolicy: 'preferred' },
    'derived',
    now,
  );
}

describe('a fallback hold', () => {
  it('A held Chat resolves to the held model', () => {
    const resolved = resolve(STORED, {}, 'owner', BEFORE);

    expect(resolved.selector).toBe('@coding');
    expect(resolved.model.id).toBe(SONNET.id);
    expect(resolved.effort).toBe('low');

    // The request resolved exactly what the Chat stores: nothing to write.
    expect(resolved.nextSelection).toBeUndefined();
  });

  it('A send after the reset clears the hold and returns to the primary', () => {
    const resolved = resolve(STORED, {}, 'owner', AFTER);

    expect(resolved.model.id).toBe(CODEX.id);
    expect(resolved.effort).toBe('high');
    expect(resolved.nextSelection).toEqual({
      revision: 3,
      selector: '@coding',
      effort: 'high',
    });
  });

  it('expires a hold at its exact revertAt instant', () => {
    const resolved = resolve(STORED, {}, 'owner', new Date(HOLD.revertAt));

    expect(resolved.model.id).toBe(CODEX.id);
    expect(resolved.nextSelection).toEqual({
      revision: 3,
      selector: '@coding',
      effort: 'high',
    });
  });

  it('The held model left the role', () => {
    const orphaned: ChatModelSelection = {
      ...STORED,
      hold: { ...HOLD, modelId: FAST.id },
    };

    const resolved = resolve(orphaned, {}, 'owner', BEFORE);

    expect(resolved.model.id).toBe(CODEX.id);
    expect(resolved.nextSelection).not.toHaveProperty('hold');
  });

  it('An effort that only the held model declares', () => {
    const named = resolve(STORED, { effort: 'xhigh' }, 'owner', BEFORE);

    expect(named.model.id).toBe(SONNET.id);
    expect(named.effort).toBe('xhigh');
    // The named effort is stored on the hold, which still serves the Run.
    expect(named.nextSelection).toEqual({
      revision: 3,
      selector: '@coding',
      effort: 'high',
      hold: { ...HOLD, effort: 'xhigh' },
    });

    // The same level is refused once the hold no longer applies, because the
    // primary does not declare it.
    expect(() => resolve(STORED, { effort: 'xhigh' }, 'owner', AFTER)).toThrow(
      EffortNotAvailableError,
    );
  });

  it('An omitted effort follows one order', () => {
    // The hold's effort wins over the stored one.
    expect(resolve(STORED, {}, 'owner', BEFORE).effort).toBe('low');

    // The held candidate omits effort, so the primary's `high` does not leak
    // into the held model; the held model's default applies instead.
    const noHoldEffort: ChatModelSelection = {
      ...STORED,
      hold: { ...HOLD, effort: null },
    };

    const resolved = resolve(noHoldEffort, {}, 'owner', BEFORE);

    expect(resolved.model.id).toBe(SONNET.id);
    expect(resolved.effort).toBe('low');
  });

  it('An owner pick clears the hold', () => {
    const picked = resolve(STORED, { selector: '@coding' }, 'owner', BEFORE);

    expect(picked.model.id).toBe(CODEX.id);
    expect(picked.effort).toBe('high');
    expect(picked.nextSelection).toEqual({
      revision: 3,
      selector: '@coding',
      effort: 'high',
    });
  });

  it('The owner changes only the effort', () => {
    const changed = resolve(STORED, { effort: 'xhigh' }, 'owner', BEFORE);

    expect(changed.model.id).toBe(SONNET.id);
    expect(changed.effort).toBe('xhigh');
    // The owner's selector and effort stay; the new effort rides the hold.
    expect(changed.nextSelection).toEqual({
      revision: 3,
      selector: '@coding',
      effort: 'high',
      hold: { ...HOLD, effort: 'xhigh' },
    });
  });

  it('Other Run creators clear a dropped hold and keep the revision', () => {
    const cleared = resolve(STORED, {}, 'derived', AFTER);

    expect(cleared.model.id).toBe(CODEX.id);
    expect(cleared.nextSelection).toEqual({
      revision: STORED.revision,
      selector: '@coding',
      effort: 'high',
    });

    // An applying hold still leaves a derived creator with nothing to write.
    expect(
      resolve(STORED, {}, 'derived', BEFORE).nextSelection,
    ).toBeUndefined();
  });

  it('A derived creator that drops an expired hold keeps the stored effort', () => {
    const stored: ChatModelSelection = {
      revision: 5,
      selector: '@coding',
      effort: null,
      hold: HOLD,
    };

    const cleared = resolve(stored, {}, 'derived', AFTER);

    // The served Run follows the candidate effort, but the write must keep the
    // owner's stored effort exactly as it was.
    expect(cleared.effort).toBe('high');
    expect(cleared.nextSelection).toEqual({
      revision: 5,
      selector: '@coding',
      effort: null,
    });
  });

  it('A derived item with its own selector leaves a valid hold in place', () => {
    const resolved = resolve(STORED, { selector: '@fast' }, 'derived', BEFORE);

    expect(resolved.selector).toBe('@fast');
    expect(resolved.model.id).toBe(FAST.id);
    // The item starts on its own selector; the owner's selection and hold are
    // neither used nor removed by a creator that may not write them.
    expect(resolved.nextSelection).toBeUndefined();
  });
});

describe('a notice effort', () => {
  it('uses the hold effort under a held model', () => {
    const resolved = resolveNotice(STORED, { effort: 'high' }, BEFORE);

    expect(resolved.model.id).toBe(SONNET.id);
    expect(resolved.effort).toBe('low');
  });

  it('uses the recorded effort when the resolved model declares it', () => {
    const stored: ChatModelSelection = {
      revision: 1,
      selector: CODEX.id,
      effort: null,
    };

    const resolved = resolveNotice(stored, { effort: 'high' }, BEFORE);

    expect(resolved.model.id).toBe(CODEX.id);
    expect(resolved.effort).toBe('high');
  });

  it('refuses an undeclared recorded effort without a hold', () => {
    expect(() =>
      resolveNotice(null, { selector: '@coding', effort: 'medium' }, BEFORE),
    ).toThrow(EffortNotAvailableError);
  });

  it('refuses an undeclared recorded effort for an exact selector', () => {
    expect(() =>
      resolveNotice(null, { selector: CODEX.id, effort: 'xhigh' }, BEFORE),
    ).toThrow(EffortNotAvailableError);
  });

  it('still refuses a named effort the model does not declare', () => {
    expect(() =>
      resolve(null, { selector: CODEX.id, effort: 'xhigh' }, 'owner', BEFORE),
    ).toThrow(EffortNotAvailableError);
  });
});

describe('the effort after a switch follows the selected effort', () => {
  const DEEPSEEK = model('deepseek', {
    effortLevels: [{ value: 'medium' }, { value: 'high' }],
    defaultEffort: 'medium',
    cacheInvalidatedByEffortChange: false,
  });

  const OPUS = model('opus', {
    effortLevels: [{ value: 'low' }, { value: 'xhigh' }],
    defaultEffort: 'low',
    cacheInvalidatedByEffortChange: false,
  });

  it('The new model declares the selected level', () => {
    expect(
      effortAfterSwitch({
        selectedEffort: 'high',
        model: CODEX,
        candidateEffort: 'low',
      }),
    ).toEqual({ kind: 'effort', effort: 'high' });
  });

  it('The new model does not declare the selected level', () => {
    expect(
      effortAfterSwitch({
        selectedEffort: 'xhigh',
        model: DEEPSEEK,
        candidateEffort: 'medium',
      }),
    ).toEqual({ kind: 'effort', effort: 'medium' });
  });

  it('A second switch compares with the selected effort', () => {
    // The first switch settled at `medium`; the selected `xhigh` still wins on
    // a model that declares it.
    expect(
      effortAfterSwitch({
        selectedEffort: 'xhigh',
        model: OPUS,
        candidateEffort: 'high',
      }),
    ).toEqual({ kind: 'effort', effort: 'xhigh' });
  });

  it('A model with no reasoning gets no effort', () => {
    expect(
      effortAfterSwitch({
        selectedEffort: 'high',
        model: FAST,
        candidateEffort: undefined,
      }),
    ).toEqual({ kind: 'none' });
  });

  it('falls back to the model default when the candidate names no effort', () => {
    expect(
      effortAfterSwitch({
        selectedEffort: 'xhigh',
        model: DEEPSEEK,
        candidateEffort: undefined,
      }),
    ).toEqual({ kind: 'effort', effort: 'medium' });
  });
});
