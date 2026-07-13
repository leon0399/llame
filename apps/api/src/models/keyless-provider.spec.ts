/**
 * Keyless-provider regression test (#162), unmocked: `model-client.spec.ts`
 * mocks the whole `@ai-sdk/openai` module, so it can only assert what OUR
 * code passes to `createOpenAI` — it never actually exercises
 * `@ai-sdk/provider-utils`'s `loadApiKey`, which is where the real bug lived
 * (the existing "can create the provider client without an API key" test was
 * a documented false green for exactly this reason). This file imports the
 * REAL `loadApiKey` to prove the root cause and the fix directly: omitting
 * `apiKey` throws when `OPENAI_API_KEY` is also unset; our non-empty
 * placeholder does not.
 */
import { loadApiKey } from '@ai-sdk/provider-utils';
import { LoadAPIKeyError } from '@ai-sdk/provider';

import { KEYLESS_PLACEHOLDER_API_KEY } from './openai-model-client';

describe('keyless provider credential resolution (#162)', () => {
  const originalKey = process.env.OPENAI_API_KEY;

  beforeEach(() => {
    delete process.env.OPENAI_API_KEY;
  });

  afterEach(() => {
    if (originalKey === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = originalKey;
    }
  });

  it('reproduces the #162 bug: omitting apiKey throws LoadAPIKeyError when OPENAI_API_KEY is also unset', () => {
    expect(() =>
      loadApiKey({
        apiKey: undefined,
        environmentVariableName: 'OPENAI_API_KEY',
        description: 'OpenAI',
      }),
    ).toThrow(LoadAPIKeyError);
  });

  it('the placeholder apiKey our client passes for a keyless provider never throws', () => {
    expect(
      loadApiKey({
        apiKey: KEYLESS_PLACEHOLDER_API_KEY,
        environmentVariableName: 'OPENAI_API_KEY',
        description: 'OpenAI',
      }),
    ).toBe(KEYLESS_PLACEHOLDER_API_KEY);
  });
});
