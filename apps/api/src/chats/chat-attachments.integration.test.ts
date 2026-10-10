/**
 * Owner image attachments (vision-media D5, `media-attachments`) over real
 * HTTP and Postgres: the send DTO's `file` parts, ownership under the
 * sender's identity, stored labels, and the end-to-end path from an uploaded
 * image to the provider prompt of the scripted model client, whose models
 * declare `input` so both the vision and the text-only branch run.
 *
 * Requires POSTGRES_URL to point at a migrated database, like every other
 * *.integration.test.ts here; the test:integration globalSetup provides it.
 */

import type { LanguageModelV3CallOptions } from '@ai-sdk/provider';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { type Server } from 'node:http';
import request from 'supertest';
import { z } from 'zod';

import { AppModule } from '../app.module';
import { configureApp } from '../app.setup';
import { TenantDbService } from '../db/tenant-db.service';
import { randomPng } from '../media/media-fixtures';
import { ModelsService } from '../models/models.service';
import { ScriptedModelsService } from '../runs/scripted-model-client';
import { CanonicalSearchCoverageService } from '../search/canonical-search-activation.service';
import {
  cookieOf,
  expectMessageParts,
  expectRegisteredUserId,
} from '../testing/support';
import { ChatsRepository, MessagesRepository } from './chats-repository';

const hasDb = !!process.env.POSTGRES_URL;
const d = hasDb ? describe : describe.skip;

vi.setConfig({ testTimeout: 60_000 });

type Prompt = LanguageModelV3CallOptions['prompt'];
type PromptPart = Extract<Prompt[number], { role: 'user' }>['content'][number];

const descriptorSchema = z.object({
  id: z.string(),
  locator: z.string(),
  name: z.string(),
  mediaType: z.string(),
  width: z.number(),
  height: z.number(),
  model: z.object({ mediaType: z.string() }),
});
type Descriptor = z.infer<typeof descriptorSchema>;

const UNKNOWN_ID = '01927c1e-8f3a-7b2c-9d4e-5f6a7b8c9d0e';

/** The content of the last user message of a provider prompt. */
function lastUserContent(prompt: Prompt): Array<PromptPart> {
  const user = prompt.filter((message) => message.role === 'user').at(-1);
  if (user?.role !== 'user') throw new Error('Expected a user message');
  return user.content;
}

function partBytes(part: PromptPart | undefined): Buffer {
  if (part?.type !== 'file') throw new Error('Expected a file part');
  if (part.data instanceof Uint8Array) return Buffer.from(part.data);
  if (part.data instanceof URL) throw new Error('Expected inline image bytes');
  return Buffer.from(part.data, 'base64');
}

function textOf(part: PromptPart | undefined): string | undefined {
  return part?.type === 'text' ? part.text : undefined;
}

d('owner image attachments (HTTP)', () => {
  let app: INestApplication<Server>;
  let http: Server;
  let tenantDb: TenantDbService;
  const models = new ScriptedModelsService();
  const tag = Date.now();
  const VISION = `attach-vision-${tag}`;
  const TEXT_ONLY = `attach-text-${tag}`;
  let cookieA = '';
  let userA = '';
  let cookieB = '';
  let userB = '';

  async function register(email: string) {
    const res = await request(http)
      .post('/auth/v1/register')
      .send({ email, password: 'password123', name: 'Attach' });
    expect(res.status).toBe(201);
    const body: unknown = res.body;
    expectRegisteredUserId(body);
    return { cookie: cookieOf(res), userId: body.user.id };
  }

  async function upload(cookie: string, name = 'shot.png') {
    const res = await request(http)
      .post('/api/v1/media')
      .set('Cookie', cookie)
      .attach('file', await randomPng(), {
        filename: name,
        contentType: 'image/png',
      })
      .expect(201);
    return descriptorSchema.parse(res.body);
  }

  async function modelBytes(cookie: string, id: string): Promise<Buffer> {
    // superagent buffers image/* bodies into a Buffer.
    const res = await request(http)
      .get(`/api/v1/media/${id}/model`)
      .set('Cookie', cookie)
      .expect(200);
    return z.instanceof(Buffer).parse(res.body);
  }

  /** A titled chat, so no title-generation call joins the recorded prompts. */
  function createChat(userId: string): Promise<string> {
    return tenantDb.runAs(userId, async (tx) => {
      const chat = await new ChatsRepository(tx).create({
        ownerUserId: userId,
        title: 'Attachments',
      });
      return chat.id;
    });
  }

  function send(
    cookie: string,
    chatId: string,
    parts: ReadonlyArray<unknown>,
    modelId = VISION,
  ) {
    return request(http)
      .post(`/api/v1/chats/${chatId}/messages`)
      .set('Cookie', cookie)
      .send({ modelId, message: { id: randomUUID(), parts } });
  }

  const file = (
    media: Descriptor,
    labels: { mediaType?: string; filename?: string } = {},
  ) => ({
    type: 'file',
    mediaType: labels.mediaType ?? media.mediaType,
    url: media.locator,
    ...(labels.filename !== undefined && { filename: labels.filename }),
  });

  /** The part the server stores for `media`, whatever the client sent. */
  const stored = (media: Descriptor) => ({
    type: 'file',
    mediaType: media.mediaType,
    url: media.locator,
    filename: media.name,
  });

  function userMessages(userId: string, chatId: string) {
    return tenantDb.runAs(userId, async (tx) =>
      (await new MessagesRepository(tx).findByChatId(chatId, userId)).filter(
        (message) => message.role === 'user',
      ),
    );
  }

  /** A refused send persisted nothing: no chat, so no message and no Run. */
  async function expectNothingStored(userId: string, chatId: string) {
    const chat = await tenantDb.runAs(userId, (tx) =>
      new ChatsRepository(tx).findById(chatId, userId),
    );
    expect(chat).toBeUndefined();
    expect(await userMessages(userId, chatId)).toEqual([]);
  }

  /** The prompts sent while `act` ran. */
  async function promptsDuring(act: () => PromiseLike<request.Response>) {
    const before = models.prompts.length;
    await act();
    return models.prompts.slice(before);
  }

  /** `Image 1 (media://<id>):`, the model variant's bytes, then `text`. */
  async function expectLabelledImageBefore(
    content: Array<PromptPart>,
    media: Descriptor,
    text: string,
  ) {
    const label = content.findIndex(
      (part) => textOf(part) === `Image 1 (${media.locator}):`,
    );
    expect(label).toBeGreaterThanOrEqual(0);
    expect(content[label + 1]).toMatchObject({
      type: 'file',
      mediaType: media.model.mediaType,
    });
    expect(
      partBytes(content[label + 1]).equals(await modelBytes(cookieA, media.id)),
    ).toBe(true);
    expect(content.findIndex((part) => textOf(part) === text)).toBe(label + 2);
  }

  beforeAll(async () => {
    models.register(VISION, { kind: 'complete', text: 'seen' });
    models.registerInput(VISION, ['text', 'image']);
    models.register(TEXT_ONLY, { kind: 'complete', text: 'read' });

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CanonicalSearchCoverageService)
      .useValue({ assertReady: () => Promise.resolve() })
      .overrideProvider(ModelsService)
      .useValue(models)
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    http = app.getHttpServer();
    tenantDb = app.get(TenantDbService);

    const a = await register(`attach-a-${tag}@example.com`);
    cookieA = a.cookie;
    userA = a.userId;
    const b = await register(`attach-b-${tag}@example.com`);
    cookieB = b.cookie;
    userB = b.userId;
  });

  afterAll(async () => {
    await app?.close();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('sending file parts', () => {
    it('accepts an image-only message and stores the media labels, not the client labels', async () => {
      const shot = await upload(cookieA, 'shot.png');
      const chatId = await createChat(userA);

      await send(cookieA, chatId, [
        file(shot, { mediaType: 'image/gif', filename: 'x.gif' }),
      ]).expect(200);

      const [message] = await userMessages(userA, chatId);
      expect(message).toBeDefined();
      expectMessageParts(message.parts, [
        {
          type: 'file',
          mediaType: 'image/png',
          url: shot.locator,
          filename: 'shot.png',
        },
      ]);
    });

    it('keeps file parts in submitted order beside the text', async () => {
      const [first, second, third] = [
        await upload(cookieA, 'a.png'),
        await upload(cookieA, 'b.png'),
        await upload(cookieA, 'c.png'),
      ];
      const chatId = await createChat(userA);

      await send(cookieA, chatId, [
        file(third),
        { type: 'text', text: 'compare' },
        file(first),
        file(second),
      ]).expect(200);

      const [message] = await userMessages(userA, chatId);
      expectMessageParts(message.parts, [
        stored(third),
        { type: 'text', text: 'compare' },
        stored(first),
        stored(second),
      ]);
    });

    it('rejects a message with neither text nor file parts', async () => {
      const chatId = randomUUID();
      await send(cookieA, chatId, []).expect(400);
      await expectNothingStored(userA, chatId);
    });

    it('rejects the whole message for a non-media URL', async () => {
      const chatId = randomUUID();
      await send(cookieA, chatId, [
        { type: 'text', text: 'see' },
        {
          type: 'file',
          mediaType: 'image/png',
          url: 'data:image/png;base64,iVBORw0KGgo=',
        },
      ]).expect(400);
      await expectNothingStored(userA, chatId);
    });

    it('rejects eleven file parts', async () => {
      const shot = await upload(cookieA);
      const chatId = randomUUID();
      await send(cookieA, chatId, [
        { type: 'text', text: 'too many' },
        ...Array.from({ length: 11 }, () => file(shot)),
      ]).expect(400);
      await expectNothingStored(userA, chatId);
    });

    it("rejects another owner's id before any row, exactly like an unknown id", async () => {
      const ownedByA = await upload(cookieA);
      const foreignChat = randomUUID();
      const unknownChat = randomUUID();

      const foreign = await send(cookieB, foreignChat, [
        { type: 'text', text: 'borrow' },
        file(ownedByA),
      ]);
      const unknown = await send(cookieB, unknownChat, [
        { type: 'text', text: 'borrow' },
        { ...file(ownedByA), url: `media://${UNKNOWN_ID}` },
      ]);

      expect(foreign.status).toBe(400);
      expect(unknown.status).toBe(foreign.status);
      expect(unknown.body).toEqual(foreign.body);
      await expectNothingStored(userB, foreignChat);
      await expectNothingStored(userB, unknownChat);
      // A's media is untouched and still A's alone.
      await request(http)
        .get(`/api/v1/media/${ownedByA.id}`)
        .set('Cookie', cookieA)
        .expect(200);
      await request(http)
        .get(`/api/v1/media/${ownedByA.id}`)
        .set('Cookie', cookieB)
        .expect(404);
    });
  });

  describe('reaching the model', () => {
    it('sends a labelled image part before the text to a vision model', async () => {
      const shot = await upload(cookieA);
      const chatId = await createChat(userA);

      const prompts = await promptsDuring(() =>
        send(cookieA, chatId, [
          { type: 'text', text: 'compare these' },
          file(shot),
        ]).expect(200),
      );

      expect(prompts).toHaveLength(1);
      await expectLabelledImageBefore(
        lastUserContent(prompts[0]),
        shot,
        'compare these',
      );
    });

    it('keeps the image when an infrastructure failure retries the Run', async () => {
      const shot = await upload(cookieA);
      const chatId = await createChat(userA);
      // Only the first pickup fails; the spy then runs the real method.
      const spy = vi
        .spyOn(models, 'createClient')
        .mockImplementationOnce(() => {
          throw new Error('simulated infra failure');
        });

      const prompts = await promptsDuring(() =>
        send(cookieA, chatId, [
          file(shot),
          { type: 'text', text: 'after retry' },
        ]).expect(200),
      );

      expect(spy.mock.calls.length).toBeGreaterThanOrEqual(2);
      expect(prompts).toHaveLength(1);
      await expectLabelledImageBefore(
        lastUserContent(prompts[0]),
        shot,
        'after retry',
      );
    });

    it("keeps the image in an owner fork's history", async () => {
      const shot = await upload(cookieA);
      const chatId = await createChat(userA);
      await send(cookieA, chatId, [
        file(shot),
        { type: 'text', text: 'original turn' },
      ]).expect(200);

      const fork = await request(http)
        .post(`/api/v1/chats/${chatId}/forks`)
        .set('Cookie', cookieA)
        .send({})
        .expect(201);
      const forkId = z.object({ id: z.string() }).parse(fork.body).id;

      const prompts = await promptsDuring(() =>
        send(cookieA, forkId, [{ type: 'text', text: 'and now?' }]).expect(200),
      );

      expect(prompts).toHaveLength(1);
      const [history] = prompts[0].filter((message) => message.role === 'user');
      if (history?.role !== 'user') throw new Error('Expected history');
      await expectLabelledImageBefore(history.content, shot, 'original turn');
    });

    it('gives a text-only model the omitted placeholder after the label', async () => {
      const shot = await upload(cookieA, 'shot.png');
      const chatId = await createChat(userA);

      const prompts = await promptsDuring(() =>
        send(
          cookieA,
          chatId,
          [file(shot), { type: 'text', text: 'what is it?' }],
          TEXT_ONLY,
        ).expect(200),
      );

      expect(prompts).toHaveLength(1);
      const content = lastUserContent(prompts[0]);
      expect(content.some((part) => part.type === 'file')).toBe(false);
      const label = content.findIndex(
        (part) => textOf(part) === `Image 1 (${shot.locator}):`,
      );
      expect(label).toBeGreaterThanOrEqual(0);
      expect(textOf(content[label + 1])).toBe(
        `[image ${shot.locator} shot.png ${shot.width}×${shot.height}, omitted: this model has no image input]`,
      );
      expect(textOf(content[label + 2])).toBe('what is it?');
    });
  });
});
