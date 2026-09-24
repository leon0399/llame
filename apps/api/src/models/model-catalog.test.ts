import {
  resolveBillingMode,
  toPublicModel,
  toTokenPrice,
} from './model-catalog';

describe('toTokenPrice', () => {
  it('carries a declared cache-write rate onto the resolved price', () => {
    expect(
      toTokenPrice({
        input: 3,
        cachedInput: 0.3,
        output: 15,
        cacheWrite: 3.75,
      }),
    ).toEqual({
      inputUsdPer1M: 3,
      cachedInputUsdPer1M: 0.3,
      cacheWriteUsdPer1M: 3.75,
      outputUsdPer1M: 15,
    });
  });

  it('resolves no cache-write rate when the entry declares none', () => {
    const price = toTokenPrice({ input: 3, output: 15 });

    // Absent, never defaulted: the input-rate fallback belongs to the cost
    // calculation, not to the resolved price.
    expect(price).toEqual({ inputUsdPer1M: 3, outputUsdPer1M: 15 });
    expect(price).not.toHaveProperty('cacheWriteUsdPer1M');
  });

  it('resolves no price from a cache-write rate alone', () => {
    expect(toTokenPrice({ cacheWrite: 3.75 })).toBeUndefined();
  });
});

describe('resolveBillingMode', () => {
  it('lets a model declaration override its provider and provider-type default', () => {
    expect(resolveBillingMode('usage', 'subscription', 'openai-codex')).toBe(
      'usage',
    );
  });

  it('lets a provider declaration override its provider-type default', () => {
    expect(
      resolveBillingMode(undefined, 'subscription', 'openai-completions'),
    ).toBe('subscription');
  });

  it.each([
    ['openai-responses', 'usage'],
    ['openai-completions', 'usage'],
    ['anthropic-messages', 'usage'],
    ['openai-codex', 'subscription'],
    ['opencode-go', 'subscription'],
  ] as const)('uses the %s provider-type default', (providerType, expected) => {
    expect(resolveBillingMode(undefined, undefined, providerType)).toBe(
      expected,
    );
  });
});

describe('toPublicModel', () => {
  it('does not expose resolved billing mode', () => {
    const model = {
      id: 'model',
      source: 'system',
      contextWindowTokens: 1000,
      billing: 'subscription',
      provider: 'p',
      providerModelId: 'upstream-model',
      systemPromptTemplate: 'prompt',
      systemPromptSource: 'project_default',
      referencesSkills: false,
    } as const;

    expect(toPublicModel(model)).not.toHaveProperty('billing');
  });
});
