import { drizzle } from 'drizzle-orm/postgres-js';

import * as schema from '../db/schema';
import { TenantDbService, type Db } from '../db/tenant-db.service';
import {
  BUILT_IN_DEFAULTS,
  type ProviderConfig,
} from '../instance-config/llame-config';
import { ModelsService } from '../models/models.service';
import { createFakeModelClient } from '../models/fake-model-client';
import type { ModelClient } from '../models/model-client';
import { ChatsRepository } from '../chats/chats-repository';
import { TitleService } from './title.service';

const titleModel = {
  id: 'title-model',
  source: 'system' as const,
  provider: 'openai',
  providerModelId: 'title-model',
  contextWindowTokens: 128_000,
  systemPromptTemplate: 'title prompt',
  systemPromptSource: 'project_default' as const,
  referencesSkills: false,
};
const provider: ProviderConfig = {
  id: 'openai',
  type: 'openai-responses',
  key: null,
  baseUrl: null,
};

function makeService(client?: ModelClient) {
  const db: Db = drizzle.mock({ schema });
  const tenantDb = new TenantDbService({
    transaction: async <T>(callback: (tx: Db) => Promise<T>) => callback(db),
  });
  const runAs = vi
    .spyOn(tenantDb, 'runAs')
    .mockImplementation(
      async <T>(_userId: string, callback: (tx: Db) => Promise<T>) =>
        callback(db),
    );
  const models = new ModelsService({
    config: {
      ...BUILT_IN_DEFAULTS,
      defaults: {
        ...BUILT_IN_DEFAULTS.defaults,
        titleGenerationModelId: titleModel.id,
      },
      providers: [provider],
      models: [titleModel],
    },
    productUserAgent: 'llame/0.0.0-test',
  });
  const resolveTitleModelConfig = vi
    .spyOn(models, 'resolveTitleModelConfig')
    .mockReturnValue(titleModel);
  const createClient = vi.spyOn(models, 'createClient');
  if (client !== undefined) createClient.mockReturnValue(client);
  const setGeneratedTitle = vi
    .spyOn(ChatsRepository.prototype, 'setGeneratedTitle')
    .mockResolvedValue(undefined);
  return {
    service: new TitleService(tenantDb, models),
    models,
    runAs,
    resolveTitleModelConfig,
    createClient,
    setGeneratedTitle,
  };
}

describe('TitleService', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('skips blank user text without resolving a title model', async () => {
    const client = createFakeModelClient(['unused']);
    const { service, resolveTitleModelConfig } = makeService(client);

    await expect(
      service.maybeGenerateTitle({
        chatId: 'chat-1',
        userId: 'user-1',
        userText: '  \n',
      }),
    ).resolves.toBeUndefined();
    expect(resolveTitleModelConfig).not.toHaveBeenCalled();
  });

  it('skips generation when no title model is configured', async () => {
    const client = createFakeModelClient(['unused']);
    const { service, resolveTitleModelConfig, createClient } =
      makeService(client);
    resolveTitleModelConfig.mockReturnValue(undefined);

    await expect(
      service.maybeGenerateTitle({
        chatId: 'chat-1',
        userId: 'user-1',
        userText: 'Describe this',
      }),
    ).resolves.toBeUndefined();
    expect(createClient).not.toHaveBeenCalled();
  });

  it('prefers structured generation, sanitizes it, and writes only the generated title', async () => {
    const client = createFakeModelClient(['unused']);
    const generateObject = vi
      .fn<NonNullable<ModelClient['generateObject']>>()
      .mockResolvedValue({ title: '  Title: **Generated topic**  ' });
    Object.assign(client, { generateObject });
    const { service, createClient, runAs, setGeneratedTitle } =
      makeService(client);

    await service.maybeGenerateTitle({
      chatId: 'chat-1',
      userId: 'user-1',
      userText: 'A user request',
    });

    expect(createClient).toHaveBeenCalledWith(titleModel.id);
    // provider-api-selection D5: the title prompt is a different conversation
    // over the same Chat, so it carries that Chat's id on the `title` lane —
    // the turn's identity with only the lane changed.
    expect(generateObject).toHaveBeenCalledWith(
      expect.objectContaining({ chat: { id: 'chat-1', lane: 'title' } }),
    );
    expect(setGeneratedTitle).toHaveBeenCalledWith(
      'chat-1',
      'user-1',
      'Generated topic',
    );
    expect(runAs).toHaveBeenCalledWith('user-1', expect.any(Function));
  });

  it('falls back to streamed text when structured generation fails', async () => {
    const client = createFakeModelClient(['# Fallback title']);
    const generateObject = vi
      .fn<NonNullable<ModelClient['generateObject']>>()
      .mockRejectedValue(new Error('tool calling unsupported'));
    Object.assign(client, { generateObject });
    const streamText = vi.spyOn(client, 'streamText');
    const { service, setGeneratedTitle } = makeService(client);

    await service.maybeGenerateTitle({
      chatId: 'chat-1',
      userId: 'user-1',
      userText: 'A user request',
    });

    // The fallback path is the same title-lane request over the text route.
    expect(streamText).toHaveBeenCalledWith(
      expect.objectContaining({ chat: { id: 'chat-1', lane: 'title' } }),
    );
    // ...and the identity is not smuggled into the prompt text itself.
    const titleRequest = streamText.mock.calls[0]?.[0];
    const sent = JSON.stringify({
      system: titleRequest?.system,
      messages: titleRequest?.messages,
    });
    expect(sent).not.toContain('chat-1');
    expect(setGeneratedTitle).toHaveBeenCalledWith(
      'chat-1',
      'user-1',
      'Fallback title',
    );
  });

  it('does not write an unusable title and swallows model failures', async () => {
    const emptyClient = createFakeModelClient(['unused']);
    const generateObject = vi
      .fn<NonNullable<ModelClient['generateObject']>>()
      .mockResolvedValue({ title: '### ""' });
    Object.assign(emptyClient, { generateObject });
    const empty = makeService(emptyClient);
    await empty.service.maybeGenerateTitle({
      chatId: 'chat-1',
      userId: 'user-1',
      userText: 'A user request',
    });
    expect(empty.setGeneratedTitle).not.toHaveBeenCalled();

    const failingModels = makeService(createFakeModelClient(['unused']));
    vi.spyOn(failingModels.models, 'createClient').mockImplementation(() => {
      throw new Error('provider unavailable');
    });
    await expect(
      failingModels.service.maybeGenerateTitle({
        chatId: 'chat-1',
        userId: 'user-1',
        userText: 'A user request',
      }),
    ).resolves.toBeUndefined();
    expect(failingModels.setGeneratedTitle).not.toHaveBeenCalled();
  });
});
