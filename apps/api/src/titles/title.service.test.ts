import { Logger } from '@nestjs/common';
import { runInNewContext } from 'node:vm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { isRecord, isString } from '@workspace/runtime-safety';

import { TenantDbService, type Db } from '../db/tenant-db.service';
import {
  BUILT_IN_DEFAULTS,
  type ProviderConfig,
} from '../instance-config/llame-config';
import { ModelsService } from '../models/models.service';
import { createFakeModelClient } from '../models/fake-model-client';
import type { ModelClient } from '../models/model-client';
import { ProviderFailure } from '../models/provider-failure/provider-failure';
import { createModelClient } from '../models/model-client-factory';
import { createOpenAIModelClient } from '../models/openai-model-client';
import { createOpenAICompletionsModelClient } from '../models/openai-completions-model-client';
import { ChatsRepository } from '../chats/chats-repository';
import * as titleMessageQuery from '../chats/title-message-query';
import type { Chat, Message } from '../db/schema';
import { TITLE_SYSTEM_PROMPT, titleUserPrompt } from './title';
import { TitleService } from './title.service';
import { asDouble } from '../testing/support';

const titleModel = {
  id: 'title-model',
  source: 'system' as const,
  provider: 'openai',
  providerModelId: 'title-model',
  contextWindowTokens: 128_000,
  input: ['text'] as const,
  systemPromptTemplate: 'title prompt',
  systemPromptSource: 'project_default' as const,
  referencesSkills: false,
};

const provider: ProviderConfig = {
  id: 'openai',
  type: 'openai-responses',
  key: null,
  baseUrl: null,
  headers: {},
};

function makeService(client?: ModelClient) {
  const db: Db = drizzle.mock();

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
        titleGenerationSelector: titleModel.id,
      },
      providers: [provider],
      models: [titleModel],
    },
    productUserAgent: 'llame/0.0.0-test',
  });

  const resolveTitleModelConfig = vi
    .spyOn(models, 'resolveTitleModelCandidates')
    .mockReturnValue({ models: [titleModel], allowPaidFallback: false });

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

function isErrorLike(value: unknown): value is Error {
  return (
    isRecord(value) &&
    isString(value.name) &&
    isString(value.message) &&
    isString(value.stack)
  );
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
      expect.objectContaining({
        system: TITLE_SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content:
              'Based on the following conversation, generate a very short and descriptive title for:\n\n<user>\nA user request\n</user>',
          },
        ],
        chat: { id: 'chat-1', lane: 'title' },
      }),
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

  it('tries the next title role candidate after a quota failure', async () => {
    const first = createFakeModelClient(['unused']);
    vi.spyOn(first, 'streamText').mockImplementation(() => {
      throw new ProviderFailure('usage limit', { code: 'quota_exhausted' });
    });
    const second = createFakeModelClient(['unused']);
    Object.assign(second, {
      generateObject: vi
        .fn<NonNullable<ModelClient['generateObject']>>()
        .mockResolvedValue({ title: 'Recovered title' }),
    });

    const {
      service,
      createClient,
      resolveTitleModelConfig,
      setGeneratedTitle,
    } = makeService();

    resolveTitleModelConfig.mockReturnValue({
      models: [titleModel, { ...titleModel, id: 'second-title-model' }],
      allowPaidFallback: false,
    });

    createClient.mockReturnValueOnce(first).mockReturnValueOnce(second);

    await service.maybeGenerateTitle({
      chatId: 'chat-1',
      userId: 'user-1',
      userText: 'A user request',
    });

    expect(createClient).toHaveBeenNthCalledWith(2, 'second-title-model');
    expect(setGeneratedTitle).toHaveBeenCalledWith(
      'chat-1',
      'user-1',
      'Recovered title',
    );
  });

  it('skips paid title candidates when the role gate is off', async () => {
    const first = createFakeModelClient(['unused']);
    vi.spyOn(first, 'streamText').mockImplementation(() => {
      throw new ProviderFailure('provider unavailable', { code: 'overloaded' });
    });

    const fallback = createFakeModelClient(['unused']);
    Object.assign(fallback, {
      generateObject: vi
        .fn<NonNullable<ModelClient['generateObject']>>()
        .mockResolvedValue({ title: 'Free fallback title' }),
    });

    const {
      service,
      createClient,
      resolveTitleModelConfig,
      setGeneratedTitle,
    } = makeService();

    resolveTitleModelConfig.mockReturnValue({
      models: [
        { ...titleModel, billing: 'subscription' },
        { ...titleModel, id: 'paid-title-model', billing: 'usage' },
        { ...titleModel, id: 'free-title-model', billing: 'free' },
      ],
      allowPaidFallback: false,
    });

    createClient.mockReturnValueOnce(first).mockReturnValueOnce(fallback);

    await service.maybeGenerateTitle({
      chatId: 'chat-1',
      userId: 'user-1',
      userText: 'A user request',
    });

    expect(createClient).toHaveBeenCalledTimes(2);
    expect(createClient).toHaveBeenNthCalledWith(2, 'free-title-model');
    expect(setGeneratedTitle).toHaveBeenCalledWith(
      'chat-1',
      'user-1',
      'Free fallback title',
    );
  });
  it('gates each title candidate on the model it is leaving', async () => {
    const first = createFakeModelClient(['unused']);
    vi.spyOn(first, 'streamText').mockImplementation(() => {
      throw new ProviderFailure('account denied', { code: 'auth' });
    });
    const second = createFakeModelClient(['unused']);
    vi.spyOn(second, 'streamText').mockImplementation(() => {
      throw new ProviderFailure('provider unavailable', { code: 'overloaded' });
    });
    const { service, createClient, resolveTitleModelConfig } = makeService();

    resolveTitleModelConfig.mockReturnValue({
      models: [
        { ...titleModel, billing: 'usage' },
        { ...titleModel, id: 'subscription', billing: 'subscription' },
        { ...titleModel, id: 'usage-fallback', billing: 'usage' },
      ],
      allowPaidFallback: false,
    });
    createClient.mockReturnValueOnce(first).mockReturnValueOnce(second);

    await service.maybeGenerateTitle({
      chatId: 'chat-1',
      userId: 'user-1',
      userText: 'A user request',
    });

    expect(createClient).toHaveBeenCalledTimes(2);
    expect(createClient).toHaveBeenNthCalledWith(2, 'subscription');
    expect(createClient).not.toHaveBeenCalledWith('usage-fallback');
  });
  it('does not advance the title walk for an ungrouped provider failure', async () => {
    const client = createFakeModelClient(['unused']);
    vi.spyOn(client, 'streamText').mockImplementation(() => {
      throw new ProviderFailure('content policy', { code: 'content_policy' });
    });

    const { service, createClient, resolveTitleModelConfig } =
      makeService(client);

    resolveTitleModelConfig.mockReturnValue({
      models: [
        titleModel,
        { ...titleModel, id: 'second-title-model', billing: 'usage' },
      ],
      allowPaidFallback: true,
    });

    await service.maybeGenerateTitle({
      chatId: 'chat-1',
      userId: 'user-1',
      userText: 'A user request',
    });

    expect(createClient).toHaveBeenCalledTimes(1);
  });

  it('keeps the title unchanged when every title role candidate fails', async () => {
    const client = createFakeModelClient(['unused']);
    vi.spyOn(client, 'streamText').mockImplementation(() => {
      throw new ProviderFailure('provider unavailable', { code: 'overloaded' });
    });

    const {
      service,
      createClient,
      resolveTitleModelConfig,
      setGeneratedTitle,
    } = makeService(client);

    resolveTitleModelConfig.mockReturnValue({
      models: [titleModel, { ...titleModel, id: 'second-title-model' }],
      allowPaidFallback: false,
    });

    await service.maybeGenerateTitle({
      chatId: 'chat-1',
      userId: 'user-1',
      userText: 'A user request',
    });

    expect(createClient).toHaveBeenCalledTimes(2);
    expect(setGeneratedTitle).not.toHaveBeenCalled();
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

  it('logs a failure without the configured credential the provider echoed', async () => {
    const key = 'CONFIGURED-KEY-CANARY-3d9e';

    // The real Chat Completions client behind the factory's wrapper, with only
    // the transport stubbed: the upstream echoes the entry's own key.
    const client = createModelClient(
      {
        provider: {
          id: 'completions',
          type: 'openai-completions',
          key,
          baseUrl: 'https://endpoint.example.test/v1',
          headers: {},
        },
        model: { ...titleModel, provider: 'completions' },
        userAgent: 'llame/0.0.0-test',
        credentials: [key],
      },
      {
        createOpenAIModelClient,
        createOpenAICompletionsModelClient: (config) =>
          createOpenAICompletionsModelClient({
            ...config,
            fetch: () =>
              Promise.resolve(
                new Response(
                  JSON.stringify({ error: { message: `echoed ${key}` } }),
                  {
                    status: 401,
                    headers: { 'content-type': 'application/json' },
                  },
                ),
              ),
          }),
      },
    );

    const warn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);

    const error = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);

    const { service } = makeService(client);

    await service.maybeGenerateTitle({
      chatId: 'chat-1',
      userId: 'user-1',
      userText: 'A user request',
    });

    const printed = [...warn.mock.calls, ...error.mock.calls]
      .flat()
      .map(String)
      .join('\n');

    expect(printed).toContain('[REDACTED]');
    expect(printed).not.toContain(key);
  });
});

describe('TitleService.regenerate', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses recent history, the title model, and an owner-scoped title update', async () => {
    const client = createFakeModelClient(['unused']);

    const generateObject = vi
      .fn<NonNullable<ModelClient['generateObject']>>()
      .mockResolvedValue({ title: 'Migration plan' });

    Object.assign(client, { generateObject });
    const { service, createClient, setGeneratedTitle } = makeService(client);
    const chat = asDouble<Chat>({ id: 'chat-1', archivedAt: null });

    const message = asDouble<Message>({
      id: 'message-1',
      chatId: 'chat-1',
      seq: 1,
      role: 'user',
      senderUserId: 'user-1',
      parts: [{ type: 'text', text: 'Recent request' }],
    });

    vi.spyOn(ChatsRepository.prototype, 'findById').mockResolvedValue(chat);
    vi.spyOn(titleMessageQuery, 'queryLatestTitleMessages').mockResolvedValue([
      message,
    ]);

    const update = vi
      .spyOn(ChatsRepository.prototype, 'update')
      .mockResolvedValue({ ...chat, title: 'Migration plan' });

    await expect(
      service.regenerate({ chatId: 'chat-1', userId: 'user-1' }),
    ).resolves.toEqual({ ok: true, title: 'Migration plan' });
    expect(createClient).toHaveBeenCalledWith(titleModel.id);
    expect(generateObject).toHaveBeenCalledWith(
      expect.objectContaining({
        system: TITLE_SYSTEM_PROMPT,
        messages: [
          { role: 'user', content: titleUserPrompt('User: Recent request') },
        ],
        chat: { id: 'chat-1', lane: 'title' },
      }),
    );
    expect(update).toHaveBeenCalledWith('chat-1', 'user-1', {
      title: 'Migration plan',
    });
    expect(setGeneratedTitle).not.toHaveBeenCalled();
  });

  it('reports a generated title as failed when the owner-scoped update misses', async () => {
    const client = createFakeModelClient(['unused']);
    Object.assign(client, {
      generateObject: vi
        .fn<NonNullable<ModelClient['generateObject']>>()
        .mockResolvedValue({ title: 'Migration plan' }),
    });
    const { service } = makeService(client);
    vi.spyOn(ChatsRepository.prototype, 'findById').mockResolvedValue(
      asDouble<Chat>({ id: 'chat-1', archivedAt: null }),
    );
    vi.spyOn(titleMessageQuery, 'queryLatestTitleMessages').mockResolvedValue([
      asDouble<Message>({
        id: 'message-1',
        chatId: 'chat-1',
        seq: 1,
        role: 'user',
        senderUserId: 'user-1',
        parts: [{ type: 'text', text: 'Request' }],
      }),
    ]);
    vi.spyOn(ChatsRepository.prototype, 'update').mockResolvedValue(undefined);

    await expect(
      service.regenerate({ chatId: 'chat-1', userId: 'user-1' }),
    ).resolves.toEqual({ ok: false, reason: 'failed' });
  });

  it('does not request a title when no title model is configured', async () => {
    const { service, resolveTitleModelConfig, createClient } = makeService(
      createFakeModelClient(['unused']),
    );

    vi.spyOn(ChatsRepository.prototype, 'findById').mockResolvedValue(
      asDouble<Chat>({ id: 'chat-1', archivedAt: null }),
    );
    resolveTitleModelConfig.mockReturnValue(undefined);

    const findRows = vi.spyOn(titleMessageQuery, 'queryLatestTitleMessages');

    await expect(
      service.regenerate({ chatId: 'chat-1', userId: 'user-1' }),
    ).resolves.toEqual({ ok: false, reason: 'not_configured' });
    expect(findRows).not.toHaveBeenCalled();
    expect(createClient).not.toHaveBeenCalled();
  });

  it('returns empty without calling the model when no eligible rows exist', async () => {
    const { service, createClient } = makeService(
      createFakeModelClient(['unused']),
    );

    vi.spyOn(ChatsRepository.prototype, 'findById').mockResolvedValue(
      asDouble<Chat>({ id: 'chat-1', archivedAt: null }),
    );
    vi.spyOn(titleMessageQuery, 'queryLatestTitleMessages').mockResolvedValue(
      [],
    );

    await expect(
      service.regenerate({ chatId: 'chat-1', userId: 'user-1' }),
    ).resolves.toEqual({ ok: false, reason: 'empty' });
    expect(createClient).not.toHaveBeenCalled();
  });

  it('returns failed for a title that sanitizes to empty', async () => {
    const client = createFakeModelClient(['unused']);

    const generateObject = vi
      .fn<NonNullable<ModelClient['generateObject']>>()
      .mockResolvedValue({ title: '### ""' });

    Object.assign(client, { generateObject });
    const { service } = makeService(client);
    const update = vi.spyOn(ChatsRepository.prototype, 'update');
    vi.spyOn(ChatsRepository.prototype, 'findById').mockResolvedValue(
      asDouble<Chat>({ id: 'chat-1', archivedAt: null }),
    );
    vi.spyOn(titleMessageQuery, 'queryLatestTitleMessages').mockResolvedValue([
      asDouble<Message>({
        id: 'message-1',
        chatId: 'chat-1',
        seq: 1,
        role: 'user',
        senderUserId: 'user-1',
        parts: [{ type: 'text', text: 'Request' }],
      }),
    ]);

    await expect(
      service.regenerate({ chatId: 'chat-1', userId: 'user-1' }),
    ).resolves.toEqual({ ok: false, reason: 'failed' });
    expect(update).not.toHaveBeenCalled();
  });

  it('returns failed when the structured and text title requests both throw', async () => {
    const client = createFakeModelClient(['unused']);
    Object.assign(client, {
      generateObject: vi
        .fn<NonNullable<ModelClient['generateObject']>>()
        .mockRejectedValue(new Error('structured unavailable')),
    });

    const textFailure: unknown = runInNewContext(
      'new Error("text unavailable")',
    );

    if (!isErrorLike(textFailure)) {
      throw new Error('Expected an Error-like value from the isolated realm.');
    }

    vi.spyOn(client, 'streamText').mockImplementation(() => {
      throw textFailure;
    });
    const warn = vi.spyOn(Logger.prototype, 'warn');
    const { service } = makeService(client);
    vi.spyOn(ChatsRepository.prototype, 'findById').mockResolvedValue(
      asDouble<Chat>({ id: 'chat-1', archivedAt: null }),
    );
    vi.spyOn(titleMessageQuery, 'queryLatestTitleMessages').mockResolvedValue([
      asDouble<Message>({
        id: 'message-1',
        chatId: 'chat-1',
        seq: 1,
        role: 'user',
        senderUserId: 'user-1',
        parts: [{ type: 'text', text: 'Request' }],
      }),
    ]);

    await expect(
      service.regenerate({ chatId: 'chat-1', userId: 'user-1' }),
    ).resolves.toEqual({ ok: false, reason: 'failed' });
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('Title generation failed: unknown error'),
    );
  });
});
