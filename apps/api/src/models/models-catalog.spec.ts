import { ConfigService } from '@nestjs/config';

import { SecretString } from '../providers/credential-crypto';
import {
  type AvailableProviderModel,
  type ProvidersService,
  type ResolvedProviderCredential,
} from '../providers/providers.service';
import { ModelNotAvailableError, ModelsService } from './models.service';

function makeService(
  env: Record<string, string>,
  providerModels: AvailableProviderModel[] = [],
  resolveForAccount: (
    accountId: string,
  ) => ResolvedProviderCredential | null = () => null,
): ModelsService {
  const config = { get: (key: string) => env[key] } as unknown as ConfigService;
  const providers = {
    listAvailableModels: jest.fn().mockResolvedValue(providerModels),
    resolveUserCredential: jest.fn().mockResolvedValue(null),
    resolveCredentialForAccount: jest
      .fn()
      .mockImplementation((_userId: string, accountId: string) =>
        Promise.resolve(resolveForAccount(accountId)),
      ),
  } as unknown as ProvidersService;
  return new ModelsService(config, providers);
}

const providerModel = (
  partial: Partial<AvailableProviderModel>,
): AvailableProviderModel => ({
  id: 'openai/gpt-5.4-mini',
  providerAccountId: 'acc-1',
  providerType: 'openrouter',
  displayName: 'My OpenRouter',
  ...partial,
});

describe('ModelsService.listAvailableModels (#76)', () => {
  it('is empty with no provider models and no instance key', async () => {
    expect(await makeService({}).listAvailableModels('u1')).toEqual([]);
  });

  it('includes the instance-env model when a key is configured', async () => {
    const models = await makeService({
      OPENAI_API_KEY: 'sk-env',
      OPENAI_MODEL: 'gpt-env',
    }).listAvailableModels('u1');
    expect(models).toEqual([
      {
        id: 'gpt-env',
        label: 'gpt-env',
        providerType: 'openai_compatible',
        source: 'instance',
        providerAccountId: null,
      },
    ]);
  });

  it('lists BYOK account models alongside the instance model', async () => {
    const models = await makeService({ OPENAI_API_KEY: 'sk-env' }, [
      providerModel({}),
    ]).listAvailableModels('u1');
    expect(models.map((m) => m.id).sort()).toEqual([
      'gpt-5.4-mini',
      'openai/gpt-5.4-mini',
    ]);
    const byok = models.find((m) => m.source === 'byok');
    expect(byok?.providerAccountId).toBe('acc-1');
  });

  it('dedupes: a BYOK model shadows the instance model of the same id', async () => {
    const models = await makeService(
      { OPENAI_API_KEY: 'sk-env', OPENAI_MODEL: 'shared-id' },
      [providerModel({ id: 'shared-id' })],
    ).listAvailableModels('u1');
    expect(models).toHaveLength(1);
    expect(models[0].source).toBe('byok');
  });
});

describe('ModelsService.resolveForModel (#76)', () => {
  it('falls back to default resolution when no model is selected', async () => {
    const service = makeService({ OPENAI_API_KEY: 'sk-env' });
    const resolved = await service.resolveForModel('u1', undefined);
    expect(resolved.source).toBe('instance');
    expect(resolved.apiKey.reveal()).toBe('sk-env');
  });

  it('rejects a model outside the available set (fail closed)', async () => {
    const service = makeService({ OPENAI_API_KEY: 'sk-env' }, [
      providerModel({}),
    ]);
    await expect(service.resolveForModel('u1', 'ghost/model')).rejects.toThrow(
      ModelNotAvailableError,
    );
  });

  it('resolves the instance model by id', async () => {
    const service = makeService({
      OPENAI_API_KEY: 'sk-env',
      OPENAI_MODEL: 'gpt-env',
    });
    const resolved = await service.resolveForModel('u1', 'gpt-env');
    expect(resolved.source).toBe('instance');
    expect(resolved.model).toBe('gpt-env');
  });

  it('resolves a BYOK model to its OWNING account credential', async () => {
    const service = makeService(
      { OPENAI_API_KEY: 'sk-env' },
      [providerModel({ id: 'or/model', providerAccountId: 'acc-9' })],
      (accountId) =>
        accountId === 'acc-9'
          ? {
              apiKey: new SecretString('sk-account-9'),
              source: 'byok',
              providerType: 'openrouter',
              providerAccountId: 'acc-9',
            }
          : null,
    );
    const resolved = await service.resolveForModel('u1', 'or/model');
    expect(resolved.source).toBe('byok');
    expect(resolved.model).toBe('or/model');
    expect(resolved.apiKey.reveal()).toBe('sk-account-9');
    expect(resolved.providerType).toBe('openrouter');
  });

  it('fails closed when the owning account vanished after listing', async () => {
    const service = makeService(
      { OPENAI_API_KEY: 'sk-env' },
      [providerModel({ id: 'or/model', providerAccountId: 'acc-gone' })],
      () => null, // account no longer resolvable
    );
    await expect(service.resolveForModel('u1', 'or/model')).rejects.toThrow(
      ModelNotAvailableError,
    );
  });
});
