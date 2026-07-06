import { ConfigService } from '@nestjs/config';

import { applyModelAllowlist, ModelsService } from './models.service';
import { createOpenAIModelClient } from './openai-model-client';

jest.mock('./openai-model-client', () => ({
  createOpenAIModelClient: jest.fn(() => ({
    model: 'stub',
    provider: 'openai',
    streamText: jest.fn(),
  })),
}));

const createOpenAIModelClientMock = jest.mocked(createOpenAIModelClient);

function createService(env: Record<string, string>): ModelsService {
  const config = {
    get: (key: string) => env[key],
  } as unknown as ConfigService;
  // No BYOK accounts in these unit tests — resolution falls through to env.
  const providers = {
    resolveUserCredential: jest.fn().mockResolvedValue(null),
    listAvailableModels: jest.fn().mockResolvedValue([]),
  } as unknown as import('../providers/providers.service').ProvidersService;
  // No allowlist configured in these unit tests (empty snapshot → no filtering).
  const resolver = {
    resolveForUser: jest.fn().mockResolvedValue({ effective: {} }),
  } as unknown as import('../config-resolver/config-resolver.service').ConfigResolverService;

  return new ModelsService(config, providers, resolver);
}

describe('ModelsService', () => {
  beforeEach(() => {
    createOpenAIModelClientMock.mockClear();
  });

  it('builds the client from OPENAI_MODEL and OPENAI_BASE_URL when set', () => {
    const service = createService({
      OPENAI_MODEL: 'openai/gpt-oss-20b:free',
      OPENAI_BASE_URL: 'https://openrouter.ai/api/v1',
    });

    service.createOpenAIClient('sk-key');

    expect(createOpenAIModelClientMock).toHaveBeenCalledWith(
      'sk-key',
      'openai/gpt-oss-20b:free',
      'https://openrouter.ai/api/v1',
    );
  });

  it('falls back to the built-in default when the env is not set', () => {
    const service = createService({});

    service.createOpenAIClient('sk-key');

    expect(createOpenAIModelClientMock).toHaveBeenCalledWith(
      'sk-key',
      undefined,
      undefined,
    );
  });

  it('treats empty-string env values (as shipped in .env.example) as unset', () => {
    const service = createService({
      OPENAI_MODEL: '',
      OPENAI_BASE_URL: '',
    });

    service.createOpenAIClient('sk-key');

    expect(createOpenAIModelClientMock).toHaveBeenCalledWith(
      'sk-key',
      undefined,
      undefined,
    );
  });

  it('prefers an explicit model argument over the env default', () => {
    const service = createService({
      OPENAI_MODEL: 'openai/gpt-oss-20b:free',
    });

    service.createOpenAIClient('sk-key', 'gpt-explicit');

    expect(createOpenAIModelClientMock).toHaveBeenCalledWith(
      'sk-key',
      'gpt-explicit',
      undefined,
    );
  });
});

describe('applyModelAllowlist (#85)', () => {
  const models = [{ id: 'gpt-4o' }, { id: 'claude-4-opus' }, { id: 'grok-3' }];

  it('leaves models unchanged when there is no allowlist', () => {
    expect(applyModelAllowlist(models, undefined)).toEqual(models);
  });

  it('keeps only allowlisted ids, order preserved', () => {
    expect(applyModelAllowlist(models, ['grok-3', 'gpt-4o'])).toEqual([
      { id: 'gpt-4o' },
      { id: 'grok-3' },
    ]);
  });

  it('an allowlisted id the user does not have yields no phantom entry', () => {
    expect(applyModelAllowlist(models, ['gpt-4o', 'not-owned'])).toEqual([
      { id: 'gpt-4o' },
    ]);
  });

  it('an allowlist matching nothing yields an empty set (fail-closed)', () => {
    expect(applyModelAllowlist(models, ['nope'])).toEqual([]);
  });
});
