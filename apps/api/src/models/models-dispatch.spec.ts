import { ConfigService } from '@nestjs/config';

import { SecretString } from '../providers/credential-crypto';
import { type ProvidersService } from '../providers/providers.service';
import {
  ModelsService,
  UnsupportedProviderTypeError,
  type ResolvedModelCredential,
} from './models.service';
import { createOpenAIModelClient } from './openai-model-client';
import { createOpenRouterModelClient } from './openrouter-model-client';

jest.mock('./openai-model-client', () => ({
  createOpenAIModelClient: jest.fn(() => ({
    model: 'stub-openai',
    provider: 'openai',
    streamText: jest.fn(),
  })),
}));
jest.mock('./openrouter-model-client', () => ({
  createOpenRouterModelClient: jest.fn(() => ({
    model: 'stub-openrouter',
    provider: 'openrouter',
    streamText: jest.fn(),
  })),
}));

const openaiMock = jest.mocked(createOpenAIModelClient);
const openrouterMock = jest.mocked(createOpenRouterModelClient);

function createService(
  env: Record<string, string> = {},
  byok: unknown = null,
): ModelsService {
  const config = { get: (key: string) => env[key] } as unknown as ConfigService;
  const providers = {
    resolveUserCredential: jest.fn().mockResolvedValue(byok),
  } as unknown as ProvidersService;
  return new ModelsService(config, providers);
}

const credential = (
  partial: Partial<ResolvedModelCredential>,
): ResolvedModelCredential => ({
  apiKey: new SecretString('sk-dispatch'),
  source: 'byok',
  ...partial,
});

describe('ModelsService adapter dispatch (#82)', () => {
  beforeEach(() => {
    openaiMock.mockClear();
    openrouterMock.mockClear();
  });

  it('routes openrouter accounts through the NATIVE provider path', () => {
    const client = createService().createModelClient(
      credential({
        providerType: 'openrouter',
        model: 'anthropic/claude-sonnet-5',
      }),
    );
    expect(client.provider).toBe('openrouter');
    expect(openrouterMock).toHaveBeenCalledWith(
      'sk-dispatch',
      'anthropic/claude-sonnet-5',
    );
    expect(openaiMock).not.toHaveBeenCalled();
  });

  it('routes openai_compatible accounts through the OpenAI-compatible client', () => {
    createService().createModelClient(
      credential({
        providerType: 'openai_compatible',
        baseUrl: 'https://groq.example/v1',
        model: 'llama-x',
      }),
    );
    expect(openaiMock).toHaveBeenCalledWith(
      'sk-dispatch',
      'llama-x',
      'https://groq.example/v1',
    );
    expect(openrouterMock).not.toHaveBeenCalled();
  });

  it('treats a missing providerType as the env/openai_compatible path', () => {
    createService({ OPENAI_MODEL: 'gpt-env' }).createModelClient(
      credential({ providerType: undefined, source: 'instance' }),
    );
    expect(openaiMock).toHaveBeenCalledWith(
      'sk-dispatch',
      'gpt-env',
      undefined,
    );
  });

  it('fails closed on provider types without an adapter', () => {
    expect(() =>
      createService().createModelClient(
        credential({ providerType: 'anthropic' }),
      ),
    ).toThrow(UnsupportedProviderTypeError);
    expect(openaiMock).not.toHaveBeenCalled();
    expect(openrouterMock).not.toHaveBeenCalled();
  });

  it('resolution threads the BYOK providerType through to dispatch', async () => {
    const service = createService(
      {},
      {
        apiKey: new SecretString('sk-or'),
        source: 'byok',
        providerType: 'openrouter',
        model: 'openai/gpt-5.4-mini',
      },
    );
    const resolved = await service.resolveModelCredential('user-1');
    expect(resolved.providerType).toBe('openrouter');
    service.createModelClient(resolved);
    expect(openrouterMock).toHaveBeenCalledWith('sk-or', 'openai/gpt-5.4-mini');
  });
});
