/**
 * `composeProviderOptions` — the request-options composition every model
 * client shares (design D5 under `anthropic-provider`): the operator's
 * `models[].providerOptions` merges over per-request-kind client defaults,
 * below the run's resolved effort and the client's invariants, with `null`
 * removing a key at any depth and reserved keys stripped from the operator
 * first. These tests pin the merge algebra itself; each client's own request
 * fixtures pin how a composed record reaches its wire.
 */
import { composeProviderOptions } from './provider-options';

describe('composeProviderOptions', () => {
  it('applies defaults, operator, effort, and invariants in order', () => {
    const composed = composeProviderOptions({
      defaults: {
        onlyDefault: 'default',
        setByOperator: 'default',
        setByEffort: 'default',
        setByInvariant: 'default',
      },
      operator: {
        setByOperator: 'operator',
        setByEffort: 'operator',
        setByInvariant: 'operator',
      },
      effort: {
        setByEffort: 'effort',
        setByInvariant: 'effort',
      },
      invariants: { setByInvariant: 'invariant' },
    });

    expect(composed).toStrictEqual({
      onlyDefault: 'default',
      setByOperator: 'operator',
      setByEffort: 'effort',
      setByInvariant: 'invariant',
    });
  });

  it('merges object-valued options key by key at every depth', () => {
    const composed = composeProviderOptions({
      defaults: {
        anthropic: {
          thinking: { type: 'adaptive', display: 'summarized' },
          cacheControl: { type: 'ephemeral', ttl: '5m' },
        },
      },
      operator: {
        anthropic: {
          thinking: { display: 'omitted' },
          cacheControl: { ttl: '1h' },
        },
      },
    });

    expect(composed).toStrictEqual({
      anthropic: {
        thinking: { type: 'adaptive', display: 'omitted' },
        cacheControl: { type: 'ephemeral', ttl: '1h' },
      },
    });
  });

  it('replaces arrays and scalars instead of merging them', () => {
    const composed = composeProviderOptions({
      defaults: {
        tools: ['search'],
        temperature: 0.2,
        responseFormat: { type: 'json_object' },
        metadata: 'default',
      },
      operator: {
        tools: ['read', 'write'],
        temperature: 0.9,
        responseFormat: 'text',
        metadata: { runId: 'run_1' },
      },
    });

    expect(composed).toStrictEqual({
      tools: ['read', 'write'],
      temperature: 0.9,
      responseFormat: 'text',
      metadata: { runId: 'run_1' },
    });
  });

  it('removes a key when a layer nulls it', () => {
    const composed = composeProviderOptions({
      defaults: { store: true, reasoningSummary: 'auto' },
      operator: { store: null },
    });

    expect(composed).toStrictEqual({ reasoningSummary: 'auto' });
  });

  it('removes a nested key and keeps its siblings', () => {
    const composed = composeProviderOptions({
      defaults: {
        thinking: { type: 'adaptive', display: 'summarized' },
      },
      operator: { thinking: { display: null } },
    });

    expect(composed).toStrictEqual({ thinking: { type: 'adaptive' } });
  });

  // The same rule when no lower layer declared the parent at all: the
  // incoming object still merges key by key into a fresh record, so its null
  // leaf deletes (there is nothing beneath it to delete) and its sibling
  // survives — rather than the whole subtree being copied verbatim with the
  // null intact, which the Responses adapter's own schema then refuses for
  // every request the entry serves.
  it('removes a nested null under a parent no lower layer declared', () => {
    const composed = composeProviderOptions({
      operator: { promptCacheOptions: { ttl: null, mode: 'explicit' } },
    });

    expect(composed).toStrictEqual({
      promptCacheOptions: { mode: 'explicit' },
    });
  });

  it('keeps an object a null removal emptied rather than pruning it', () => {
    const composed = composeProviderOptions({
      defaults: { openai: { reasoningSummary: 'auto' } },
      operator: { openai: { reasoningSummary: null } },
    });

    expect(composed).toStrictEqual({ openai: {} });
  });

  it('restores a nulled key when a later layer sets it', () => {
    const composed = composeProviderOptions({
      defaults: { reasoningEffort: 'medium' },
      operator: { reasoningEffort: null },
      effort: { reasoningEffort: 'high' },
    });

    expect(composed).toStrictEqual({ reasoningEffort: 'high' });
  });

  it('keeps an invariant an operator nulls at any depth', () => {
    const composed = composeProviderOptions({
      operator: {
        store: null,
        openai: { reasoningSummary: null },
      },
      invariants: {
        store: false,
        openai: { reasoningSummary: 'auto' },
      },
    });

    expect(composed).toStrictEqual({
      store: false,
      openai: { reasoningSummary: 'auto' },
    });
  });

  it('strips reserved paths and keeps their siblings', () => {
    const composed = composeProviderOptions({
      operator: {
        conversation: 'conv_1',
        temperature: 0.4,
        thinking: { type: 'adaptive', blockBinding: 'drop' },
      },
      reservedPaths: [
        'conversation',
        'instructions',
        'thinking.blockBinding',
        'thinking.budgetTokens.blockBinding',
      ],
    });

    expect(composed).toStrictEqual({
      temperature: 0.4,
      thinking: { type: 'adaptive' },
    });
  });

  it('passes unknown keys through for the adapter to decide', () => {
    const composed = composeProviderOptions({
      operator: {
        vendorToggle: true,
        vendorTuning: { mode: 'fast', steps: [1, 2, 3] },
      },
    });

    expect(composed).toStrictEqual({
      vendorToggle: true,
      vendorTuning: { mode: 'fast', steps: [1, 2, 3] },
    });
  });

  it('keeps a literal __proto__ option as its own key rather than retargeting the result', () => {
    const composed = composeProviderOptions({
      operator: { ['__proto__']: { polluted: true } },
    });
    if (composed === undefined) {
      throw new Error('expected the __proto__ option to compose');
    }

    expect(Object.getPrototypeOf(composed)).toBe(Object.prototype);
    expect(Object.hasOwn(composed, '__proto__')).toBe(true);
    expect(composed).toEqual({ ['__proto__']: { polluted: true } });
  });

  it('never mutates an input record', () => {
    const defaults = { openai: { reasoningSummary: 'auto' } };
    const operator = {
      openai: { reasoningEffort: 'high' },
      model: 'other-model',
    };
    const effort = { openai: { reasoningEffort: 'xhigh' } };
    const invariants = { openai: { reasoningSummary: 'auto' } };
    const before = structuredClone({ defaults, operator, effort, invariants });

    const composed = composeProviderOptions({
      defaults,
      operator,
      effort,
      invariants,
      reservedPaths: ['model'],
    });

    expect({ defaults, operator, effort, invariants }).toStrictEqual(before);
    expect(composed).toStrictEqual({
      openai: { reasoningSummary: 'auto', reasoningEffort: 'xhigh' },
    });
  });

  it('returns undefined when no layer contributes a key', () => {
    expect(composeProviderOptions({})).toBeUndefined();
    expect(
      composeProviderOptions({
        defaults: {},
        operator: {},
        effort: {},
        invariants: {},
      }),
    ).toBeUndefined();
    expect(
      composeProviderOptions({ operator: { store: null } }),
    ).toBeUndefined();
    expect(
      composeProviderOptions({
        operator: { model: 'other-model' },
        reservedPaths: ['model'],
      }),
    ).toBeUndefined();
  });
});
