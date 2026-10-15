import type {
  LanguageModelV3CallOptions,
  LanguageModelV3StreamPart,
} from '@ai-sdk/provider';
import {
  simulateReadableStream,
  stepCountIs,
  streamText,
  tool,
  type ModelMessage,
  type ToolResultPart,
} from 'ai';
import { MockLanguageModelV3 } from 'ai/test';
import { z } from 'zod';

import type { HeldMedia, RetainedVariant } from '../media/attempt-media';
import {
  EPOCH_MAX_BASE64_BYTES,
  loadMediaSizing,
  toolResultOutput,
  type MediaAdmissionContext,
} from '../media/epoch-admission';
import type { RunMediaResolver } from '../media/media-descriptors';
import {
  descriptor,
  fakeResolver,
  pdfDescriptor,
} from '../media/media-fixtures';
import { buildContext, type StoredMessage } from '../chats/context-builder';
import {
  createPromptImportsItem,
  promptImportMediaKey,
} from '../chats/prompt-imports-item';
import type { ModelStreamInput } from './model-client';
import { composeStepMessages, installStepPreparation } from './step-composer';

const A = '0192f3a4-5b6c-7d8e-9f01-00000000000a';
const B = '0192f3a4-5b6c-7d8e-9f01-00000000000b';
const C = '0192f3a4-5b6c-7d8e-9f01-00000000000c';
const MISSING = '0192f3a4-5b6c-7d8e-9f01-0000000000ff';

const CHAT = {
  id: '7b1f4c2a-3d5e-4a68-9f02-1c8d6b3e5a47',
  lane: 'main',
} as const;

/** A 128,000-token vision model without an output reserve. */
const VISION: MediaAdmissionContext = {
  input: ['text', 'image'],
  contextWindowTokens: 128_000,
  reservedOutputTokens: null,
};
const TEXT_ONLY: MediaAdmissionContext = { ...VISION, input: ['text'] };
/** A 200,000-token model declaring `image` and `pdf`: a 53-page PDF bound. */
const VISION_PDF: MediaAdmissionContext = {
  input: ['text', 'image', 'pdf'],
  contextWindowTokens: 200_000,
  reservedOutputTokens: null,
};
const WINDOW = { contextWindowTokens: 128_000 };

const fileRef = (id: string) =>
  ({ type: 'file', data: `media://${id}`, mediaType: 'image/png' }) as const;
const pdfRef = (id: string) =>
  ({
    type: 'file',
    data: `media://${id}`,
    mediaType: 'application/pdf',
    filename: 'paper.pdf',
  }) as const;

function heldImageModel(resolver: RunMediaResolver, key: string) {
  const entry = resolver.heldMedia.get(key);
  return entry !== undefined && !('pages' in entry) ? entry.model : undefined;
}

describe('composeStepMessages', () => {
  it('labels each attachment and sends the model variant after the rail items, before the text', async () => {
    const { resolver } = fakeResolver([descriptor(A), descriptor(B)]);
    const messages: Array<ModelMessage> = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'rail item' },
          { type: 'text', text: 'temporal row' },
          fileRef(A),
          fileRef(B),
          { type: 'text', text: 'compare these' },
        ],
      },
    ];

    expect(
      await composeStepMessages(messages, { resolver, context: VISION }),
    ).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'rail item' },
          { type: 'text', text: 'temporal row' },
          { type: 'text', text: `Image 1 (media://${A}):` },
          {
            type: 'image',
            image: new Uint8Array([0x61]),
            mediaType: 'image/png',
          },
          { type: 'text', text: `Image 2 (media://${B}):` },
          {
            type: 'image',
            image: new Uint8Array([0x62]),
            mediaType: 'image/png',
          },
          { type: 'text', text: 'compare these' },
        ],
      },
    ]);
  });

  it('restarts labels in each message', async () => {
    const { resolver } = fakeResolver([descriptor(A), descriptor(B)]);
    const composed = await composeStepMessages(
      [
        { role: 'user', content: [fileRef(A)] },
        { role: 'assistant', content: [{ type: 'text', text: 'seen' }] },
        { role: 'user', content: [fileRef(B)] },
      ],
      { resolver, context: VISION },
    );

    expect(composed[0]?.content).toContainEqual({
      type: 'text',
      text: `Image 1 (media://${A}):`,
    });
    expect(composed[2]?.content).toContainEqual({
      type: 'text',
      text: `Image 1 (media://${B}):`,
    });
  });

  it('gives a text-only model the omitted placeholder and loads no bytes', async () => {
    const { resolver } = fakeResolver([descriptor(A, { name: 'shot.png' })]);
    const loadModelBytes = vi.spyOn(resolver, 'loadModelBytes');
    const composed = await composeStepMessages(
      [
        {
          role: 'user',
          content: [fileRef(A), { type: 'text', text: 'what?' }],
        },
      ],
      { resolver, context: TEXT_ONLY },
    );

    expect(composed).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: `Image 1 (media://${A}):` },
          {
            type: 'text',
            text: `[image media://${A} shot.png 1600×900, omitted: this model has no image input]`,
          },
          { type: 'text', text: 'what?' },
        ],
      },
    ]);
    expect(loadModelBytes).not.toHaveBeenCalled();
  });

  it('keeps the label and an unavailable placeholder for an unresolvable reference', async () => {
    const { resolver, loads } = fakeResolver([]);
    const composed = await composeStepMessages(
      [{ role: 'user', content: [fileRef(MISSING)] }],
      { resolver, context: VISION },
    );

    expect(composed).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: `Image 1 (media://${MISSING}):` },
          { type: 'text', text: `[image media://${MISSING} unavailable]` },
        ],
      },
    ]);
    expect(loads).toEqual([]);
  });

  it('gives an attached image whose bytes cannot be read the unavailable placeholder', async () => {
    const { resolver } = fakeResolver([descriptor(A)]);
    const composed = await composeStepMessages(
      [{ role: 'user', content: [fileRef(A)] }],
      {
        resolver: {
          ...resolver,
          loadModelBytes: () => Promise.resolve(new Map()),
        },
        context: VISION,
      },
    );

    expect(composed).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: `Image 1 (media://${A}):` },
          { type: 'text', text: `[image media://${A} unavailable]` },
        ],
      },
    ]);
  });

  it('sends the limit placeholder past the window and loads only attached bytes', async () => {
    // Each base64 variant is two thirds of the byte bound, so only one fits.
    const modelByteSize = EPOCH_MAX_BASE64_BYTES / 2;
    const { resolver, loads } = fakeResolver([
      descriptor(A, { modelByteSize }),
      descriptor(B, { modelByteSize }),
    ]);
    const composed = await composeStepMessages(
      [A, B].map(
        (id): ModelMessage => ({ role: 'user', content: [fileRef(id)] }),
      ),
      { resolver, context: VISION },
    );

    expect(loads).toEqual([A]);
    const anImage: unknown = expect.objectContaining({ type: 'image' });
    expect(composed[0]?.content).toEqual([
      { type: 'text', text: `Image 1 (media://${A}):` },
      anImage,
    ]);
    expect(composed[1]?.content).toEqual([
      { type: 'text', text: `Image 1 (media://${B}):` },
      {
        type: 'text',
        text: `[image media://${B} 0b.png 1600×900, not attached: this context's image limit is reached]`,
      },
    ]);
  });

  it('is idempotent and returns messages without references unchanged', async () => {
    const { resolver } = fakeResolver([descriptor(A)]);
    const plain: Array<ModelMessage> = [{ role: 'user', content: 'hello' }];
    expect(
      await composeStepMessages(plain, { resolver, context: VISION }),
    ).toBe(plain);

    // A message without a reference keeps its identity beside one that has.
    const unreferenced: ModelMessage = {
      role: 'user',
      content: [{ type: 'text', text: 'no reference' }],
    };
    const mixed = await composeStepMessages(
      [{ role: 'user', content: [fileRef(A)] }, unreferenced],
      { resolver, context: VISION },
    );
    expect(mixed[1]).toBe(unreferenced);

    const once = await composeStepMessages(
      [{ role: 'user', content: [fileRef(A)] }],
      { resolver, context: VISION },
    );
    expect(await composeStepMessages(once, { resolver, context: VISION })).toBe(
      once,
    );
  });

  describe('owner PDF attachments', () => {
    const paper = (pages = 15) =>
      pdfDescriptor(A, { name: 'paper.pdf', pages, byteSize: 2_215_244 });
    const paperMessage: ModelMessage = {
      role: 'user',
      content: [pdfRef(A), { type: 'text', text: 'summarize' }],
    };

    it('labels an attached PDF and sends its original as a named PDF file part', async () => {
      const { resolver, loads } = fakeResolver([paper()]);

      const composed = await composeStepMessages([paperMessage], {
        resolver,
        context: VISION_PDF,
      });

      expect(loads).toEqual([A]);
      expect(composed[0]?.content).toEqual([
        { type: 'text', text: `PDF 1 (media://${A}):` },
        {
          type: 'file',
          data: new Uint8Array([0x61]),
          mediaType: 'application/pdf',
          filename: 'paper.pdf',
        },
        { type: 'text', text: 'summarize' },
      ]);
    });

    it('counts images and PDFs separately within one message', async () => {
      const { resolver } = fakeResolver([
        descriptor(A),
        pdfDescriptor(B, { name: 'paper.pdf' }),
        descriptor(C),
      ]);

      const composed = await composeStepMessages(
        [
          {
            role: 'user',
            content: [
              fileRef(A),
              pdfRef(B),
              fileRef(C),
              { type: 'text', text: 'summarize' },
            ],
          },
        ],
        { resolver, context: VISION_PDF },
      );

      expect(composed[0]?.content).toEqual([
        { type: 'text', text: `Image 1 (media://${A}):` },
        {
          type: 'image',
          image: new Uint8Array([0x61]),
          mediaType: 'image/png',
        },
        { type: 'text', text: `PDF 1 (media://${B}):` },
        {
          type: 'file',
          data: new Uint8Array([0x62]),
          mediaType: 'application/pdf',
          filename: 'paper.pdf',
        },
        { type: 'text', text: `Image 2 (media://${C}):` },
        {
          type: 'image',
          image: new Uint8Array([0x63]),
          mediaType: 'image/png',
        },
        { type: 'text', text: 'summarize' },
      ]);
    });

    it.each([
      [
        'a model without PDF input the omitted placeholder',
        VISION,
        [paper()],
        `[pdf media://${A} paper.pdf 15 pages, omitted: this model has no PDF input]`,
      ],
      [
        'an unresolvable PDF reference the PDF unavailable placeholder',
        VISION_PDF,
        [],
        `[pdf media://${A} unavailable]`,
      ],
      [
        'a 64-page PDF over the 53-page bound the limit placeholder',
        VISION_PDF,
        [paper(64)],
        `[pdf media://${A} paper.pdf 64 pages, not attached: this context's PDF limit is reached]`,
      ],
    ])(
      'gives %s after its label and loads no bytes',
      async (_, context, descriptors, placeholder) => {
        const { resolver, loads } = fakeResolver(descriptors);

        const composed = await composeStepMessages([paperMessage], {
          resolver,
          context,
        });

        expect(composed[0]?.content).toEqual([
          { type: 'text', text: `PDF 1 (media://${A}):` },
          { type: 'text', text: placeholder },
          { type: 'text', text: 'summarize' },
        ]);
        expect(loads).toEqual([]);
      },
    );

    it('gives an attached PDF whose original cannot be read the PDF unavailable placeholder', async () => {
      const { resolver } = fakeResolver([paper()]);

      const composed = await composeStepMessages([paperMessage], {
        resolver: {
          ...resolver,
          loadModelBytes: () => Promise.resolve(new Map()),
        },
        context: VISION_PDF,
      });

      expect(composed[0]?.content).toContainEqual({
        type: 'text',
        text: `[pdf media://${A} unavailable]`,
      });
    });
  });

  describe('prompt-import PDFs', () => {
    const runId = '11111111-2222-4333-8444-555555555555';
    const locator = 'paper.pdf';
    const bytes = Buffer.from('%PDF-original');
    const metadata = {
      kind: 'pdf',
      mediaType: 'application/pdf',
      pages: 15,
      byteSize: bytes.byteLength,
    } as const;
    const item = createPromptImportsItem({
      runId,
      outcomes: [
        {
          locator,
          resolved: '/repo/paper.pdf',
          outcome: 'imported',
          body: JSON.stringify({
            status: 'success',
            ...metadata,
            path: '/repo/paper.pdf',
          }),
          attachment: metadata,
        },
        {
          locator: `media://${A}`,
          outcome: 'imported',
          body: JSON.stringify({
            status: 'success',
            ...metadata,
            media: `media://${A}`,
          }),
          attachment: { ...metadata, media: `media://${A}` },
        },
      ],
      omitted: [],
    });
    const stored: StoredMessage = {
      id: 'pdf-import-message',
      chatId: 'chat-1',
      seq: 1,
      role: 'user',
      senderUserId: 'user-1',
      attachments: [],
      createdAt: new Date(0),
      parts: [item, { type: 'text', text: 'summarize' }],
    };
    const messages = () =>
      buildContext([stored], {
        systemPrompt: 'system',
        requestKind: 'continuation',
      }).messages;
    const itemText = { type: 'text', text: item.data.text };
    const paper = () => pdfDescriptor(A, { name: 'archive.pdf', pages: 15 });

    it('places unstored and stored native PDFs immediately after their item text', async () => {
      const { resolver } = fakeResolver([paper()]);
      resolver.heldMedia.set(promptImportMediaKey(runId, locator), {
        locator: '/repo/paper.pdf',
        pages: 15,
        bytes,
        byteSize: bytes.byteLength,
      });

      const composed = await composeStepMessages(messages(), {
        resolver,
        context: VISION_PDF,
      });

      expect(composed[0]?.content).toEqual([
        itemText,
        {
          type: 'file',
          mediaType: 'application/pdf',
          data: bytes,
          filename: 'paper.pdf',
        },
        {
          type: 'file',
          mediaType: 'application/pdf',
          data: new Uint8Array([0x61]),
          filename: 'archive.pdf',
        },
        { type: 'text', text: 'summarize' },
      ]);
    });

    it.each([
      {
        name: 'a new attempt',
        context: VISION_PDF,
        retain: false,
        placeholder: '[pdf "paper.pdf" 15 pages, not retained]',
        storedAttached: true,
      },
      {
        name: 'a model without PDF input',
        context: TEXT_ONLY,
        retain: false,
        placeholder:
          '[pdf "paper.pdf" 15 pages, omitted: this model has no PDF input]',
        storedAttached: false,
      },
      {
        name: 'a PDF beyond the page window',
        context: { ...VISION_PDF, contextWindowTokens: 50_000 },
        retain: true,
        placeholder: `[pdf "paper.pdf" 15 pages, not attached: this context's PDF limit is reached]`,
        storedAttached: false,
      },
    ] as const)(
      'uses the correct placeholder for $name while replaying stored media independently',
      async ({ context, retain, placeholder, storedAttached }) => {
        const { resolver, loads } = fakeResolver([paper()]);
        if (retain) {
          resolver.heldMedia.set(promptImportMediaKey(runId, locator), {
            locator: '/repo/paper.pdf',
            pages: 15,
            bytes,
            byteSize: bytes.byteLength,
          });
        }

        const composed = await composeStepMessages(messages(), {
          resolver,
          context,
        });
        expect(composed[0]?.content.slice(0, 2)).toEqual([
          itemText,
          { type: 'text', text: placeholder },
        ]);
        expect(loads).toEqual(storedAttached ? [A] : []);
        if (!storedAttached) {
          expect(composed[0]?.content).not.toContainEqual(
            expect.objectContaining({ type: 'file' }),
          );
        }
      },
    );
  });

  describe('prompt-import images', () => {
    const RUN = '11111111-2222-4333-8444-555555555555';
    const KEY = promptImportMediaKey(RUN, 'shot.png');
    const THUMBNAIL = 'data:image/webp;base64,UklGRg==';
    const item = createPromptImportsItem({
      runId: RUN,
      outcomes: [
        {
          locator: 'shot.png',
          resolved: '/repo/shot.png',
          outcome: 'imported',
          body: '{"status":"success","kind":"image","path":"/repo/shot.png"}',
          attachment: {
            thumbnail: THUMBNAIL,
            width: 1600,
            height: 900,
            mediaType: 'image/png',
          },
        },
        {
          locator: `media://${A}`,
          resolved: `media://${A}`,
          outcome: 'imported',
          body: '{"status":"success","kind":"image"}',
          attachment: { media: `media://${A}` },
        },
      ],
      omitted: [],
    });
    /**
     * A stored user message whose prompt imported `@shot.png` unstored and
     * `@media://A`, beside an owner file B.
     */
    const stored: StoredMessage = {
      id: 'msg-1',
      chatId: 'chat-1',
      seq: 1,
      role: 'user',
      senderUserId: 'user-1',
      attachments: [],
      createdAt: new Date(0),
      parts: [
        item,
        { type: 'file', mediaType: 'image/png', url: `media://${B}` },
        { type: 'text', text: 'compare' },
      ],
    };
    const replay = (messages: Array<StoredMessage>) =>
      buildContext(messages, {
        systemPrompt: 'system',
        requestKind: 'continuation',
      }).messages;
    const itemText = { type: 'text', text: item.data.text } as const;
    const shotImage = (bytes: Uint8Array) =>
      ({ type: 'image', image: bytes, mediaType: 'image/png' }) as const;
    /** The importing attempt's entry for `@shot.png`, with its variant. */
    const holdShot = (resolver: RunMediaResolver, bytes: Buffer | undefined) =>
      resolver.heldMedia.set(KEY, {
        locator: '/repo/shot.png',
        width: 1600,
        height: 900,
        ...(bytes && {
          model: { bytes, mediaType: 'image/png', width: 1600, height: 900 },
        }),
      });

    it('sends the item text followed by its images, the unstored one from the attempt memory', async () => {
      const { resolver } = fakeResolver([descriptor(A), descriptor(B)]);
      const shot = Buffer.from([0x73]);
      holdShot(resolver, shot);

      const composed = await composeStepMessages(replay([stored]), {
        resolver,
        context: VISION,
      });

      expect(composed[0]?.content).toEqual([
        itemText,
        shotImage(shot),
        shotImage(new Uint8Array([0x61])),
        { type: 'text', text: `Image 1 (media://${B}):` },
        shotImage(new Uint8Array([0x62])),
        { type: 'text', text: 'compare' },
      ]);
      expect(JSON.stringify(composed)).not.toContain(THUMBNAIL);
      expect(
        await composeStepMessages(composed, { resolver, context: VISION }),
      ).toBe(composed);
    });

    it('sends a text-only model the omitted placeholders after the item text and no image', async () => {
      const { resolver, loads } = fakeResolver([
        descriptor(A, { name: 'stored.png' }),
        descriptor(B),
      ]);
      holdShot(resolver, undefined);

      const composed = await composeStepMessages(replay([stored]), {
        resolver,
        context: TEXT_ONLY,
      });

      expect(composed[0]?.content.slice(0, 3)).toEqual([
        itemText,
        {
          type: 'text',
          text: '[image "shot.png" 1600×900, omitted: this model has no image input]',
        },
        {
          type: 'text',
          text: `[image media://${A} stored.png 1600×900, omitted: this model has no image input]`,
        },
      ]);
      expect(composed[0]?.content).not.toContainEqual(
        expect.objectContaining({ type: 'image' }),
      );
      expect(loads).toEqual([]);
    });

    it('gives a later turn the not-retained placeholder and the media import from the store', async () => {
      const { resolver } = fakeResolver([descriptor(A), descriptor(B)]);

      const composed = await composeStepMessages(replay([stored]), {
        resolver,
        context: VISION,
      });

      expect(composed[0]?.content.slice(0, 3)).toEqual([
        itemText,
        {
          type: 'text',
          text: '[image "shot.png" 1600×900, not retained]',
        },
        shotImage(new Uint8Array([0x61])),
      ]);
    });

    it('gives a later text-only turn the omitted placeholder, never the not-retained one', async () => {
      const { resolver } = fakeResolver([descriptor(A), descriptor(B)]);

      const composed = await composeStepMessages(replay([stored]), {
        resolver,
        context: TEXT_ONLY,
      });

      expect(composed[0]?.content[1]).toEqual({
        type: 'text',
        text: '[image "shot.png" 1600×900, omitted: this model has no image input]',
      });
      expect(JSON.stringify(composed)).not.toContain('not retained');
    });

    /** An earlier turn whose one owner file fills most of the byte budget. */
    const earlier: StoredMessage = {
      ...stored,
      id: 'msg-0',
      seq: 0,
      parts: [
        { type: 'file', mediaType: 'image/png', url: `media://${B}` },
        { type: 'text', text: 'look' },
      ],
    };
    const trigger: StoredMessage = {
      ...stored,
      parts: [item, { type: 'text', text: 'and this?' }],
    };
    const nearlyFull = () =>
      fakeResolver([
        descriptor(A),
        descriptor(B, { modelByteSize: EPOCH_MAX_BASE64_BYTES * 0.7 }),
      ]).resolver;
    // 4 MiB of base64: past what the earlier file leaves.
    const shotBytes = () => Buffer.alloc(3_145_728);

    it('drops the bytes of an import the window refuses as the first request is composed', async () => {
      const resolver = nearlyFull();
      holdShot(resolver, shotBytes());

      const composed = await composeStepMessages(replay([earlier, trigger]), {
        resolver,
        context: VISION,
      });

      expect(composed[1]?.content[1]).toEqual({
        type: 'text',
        text: `[image "shot.png" 1600×900, not attached: this context's image limit is reached]`,
      });
      expect(heldImageModel(resolver, KEY)).toBeUndefined();
    });

    it('admits the import of a compacting attempt in the new epoch', async () => {
      const resolver = nearlyFull();
      const shot = shotBytes();
      holdShot(resolver, shot);

      // The pre-step estimate sees the overflow but drops nothing.
      const estimate = await loadMediaSizing(
        replay([earlier, trigger]),
        resolver,
        VISION,
      );
      expect(estimate.statuses).toEqual(['attached', 'limit', 'limit']);
      expect(heldImageModel(resolver, KEY)?.bytes).toBe(shot);
      // Compaction absorbed the earlier turn: the first request carries the
      // import as an image and the attempt keeps it.
      const composed = await composeStepMessages(replay([trigger]), {
        resolver,
        context: VISION,
      });

      const content = composed[0]?.content;
      const sent = Array.isArray(content) ? content[1] : undefined;
      expect(sent).toMatchObject({ type: 'image', mediaType: 'image/png' });
      expect(sent?.type === 'image' && sent.image).toBe(shot);
      expect(heldImageModel(resolver, KEY)?.bytes).toBe(shot);
    });
  });

  describe('tool results', () => {
    const ENVELOPE = '{"status":"success","kind":"image"}';
    const readResult = (toolCallId: string, id: string): ModelMessage => ({
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId,
          toolName: 'read',
          output: toolResultOutput(ENVELOPE, id),
        },
      ],
    });
    const outputOf = (message: ModelMessage | undefined) =>
      message?.role === 'tool' && message.content[0]?.type === 'tool-result'
        ? message.content[0].output
        : undefined;

    it('sends an attached read image as content after the result text, in request order with attachments', async () => {
      const { resolver, loads } = fakeResolver([descriptor(A), descriptor(B)]);
      const composed = await composeStepMessages(
        [{ role: 'user', content: [fileRef(A)] }, readResult('call-1', B)],
        { resolver, context: VISION },
      );

      expect(loads).toEqual([A, B]);
      expect(outputOf(composed[1])).toEqual({
        type: 'content',
        value: [
          { type: 'text', text: ENVELOPE },
          {
            type: 'image-data',
            data: Buffer.from([0x62]).toString('base64'),
            mediaType: 'image/png',
          },
        ],
      });
    });

    it('materializes a stored PDF tool reference as a named file', async () => {
      const { resolver } = fakeResolver([
        pdfDescriptor(A, { name: 'paper.pdf' }),
      ]);
      const envelope = '{"status":"success","kind":"pdf"}';
      const [composed] = await composeStepMessages(
        [
          {
            role: 'tool',
            content: [
              {
                type: 'tool-result',
                toolCallId: 'call-1',
                toolName: 'read',
                output: toolResultOutput(envelope, { kind: 'pdf', id: A }),
              },
            ],
          },
        ],
        { resolver, context: VISION_PDF },
      );
      expect(outputOf(composed)).toEqual({
        type: 'content',
        value: [
          { type: 'text', text: envelope },
          {
            type: 'file-data',
            filename: 'paper.pdf',
            mediaType: 'application/pdf',
            data: Buffer.from([0x61]).toString('base64'),
          },
        ],
      });
    });

    it.each([
      [
        'a text-only model',
        [descriptor(A, { name: 'shot.png' })],
        TEXT_ONLY,
        `[image media://${A} shot.png 1600×900, omitted: this model has no image input]`,
      ],
      [
        'another owner or an unknown id',
        [],
        VISION,
        `[image media://${A} unavailable]`,
      ],
    ])(
      'gives %s a text output with the placeholder and no image',
      async (_, descriptors, context, placeholder) => {
        const { resolver, loads } = fakeResolver(descriptors);
        for (const moveToolMedia of [false, true]) {
          const composed = await composeStepMessages(
            [readResult('call-1', A)],
            { resolver, context, moveToolMedia },
          );
          expect(composed).toHaveLength(1);
          expect(outputOf(composed[0])).toEqual({
            type: 'text',
            value: `${ENVELOPE}\n${placeholder}`,
          });
        }
        expect(loads).toEqual([]);
      },
    );

    describe('on a Chat Completions wire', () => {
      const image = (byte: number) => ({
        type: 'image',
        image: new Uint8Array([byte]),
        mediaType: 'image/png',
      });
      const label = (id: string) => ({
        type: 'text',
        text: `Image from read "media://${id}":`,
      });
      const moved = { type: 'text', value: ENVELOPE };
      const call = (toolCallId: string): ModelMessage => ({
        role: 'assistant',
        content: [
          { type: 'tool-call', toolCallId, toolName: 'read', input: {} },
        ],
      });

      it('moves the labelled images of consecutive tool results into one following user message', async () => {
        const { resolver, loads } = fakeResolver([
          descriptor(A),
          descriptor(B),
        ]);
        const composed = await composeStepMessages(
          [
            call('call-1'),
            readResult('call-1', A),
            readResult('call-2', B),
            call('call-3'),
            readResult('call-3', A),
          ],
          { resolver, context: VISION, moveToolMedia: true },
        );

        expect(loads).toEqual([A, B]);
        expect(composed).toHaveLength(7);
        expect(outputOf(composed[1])).toEqual(moved);
        expect(outputOf(composed[2])).toEqual(moved);
        expect(composed[3]).toEqual({
          role: 'user',
          content: [
            { type: 'text', text: 'Files from tool results:' },
            label(A),
            image(0x61),
            label(B),
            image(0x62),
          ],
        });
        expect(composed[4]).toEqual(call('call-3'));
        expect(outputOf(composed[5])).toEqual(moved);
        expect(composed[6]).toEqual({
          role: 'user',
          content: [
            { type: 'text', text: 'Files from tool results:' },
            label(A),
            image(0x61),
          ],
        });
      });

      it('moves the images of the results in one tool message, in result order', async () => {
        const { resolver } = fakeResolver([descriptor(A), descriptor(B)]);
        const [first, second] = [
          readResult('call-1', B),
          readResult('call-2', A),
        ];
        if (first?.role !== 'tool' || second?.role !== 'tool') {
          throw new Error('expected tool messages');
        }
        const composed = await composeStepMessages(
          [{ role: 'tool', content: [...first.content, ...second.content] }],
          { resolver, context: VISION, moveToolMedia: true },
        );

        expect(composed).toEqual([
          {
            role: 'tool',
            content: [
              expect.objectContaining({ toolCallId: 'call-1', output: moved }),
              expect.objectContaining({ toolCallId: 'call-2', output: moved }),
            ],
          },
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Files from tool results:' },
              label(B),
              image(0x62),
              label(A),
              image(0x61),
            ],
          },
        ]);
      });

      it('leaves a content result without images beside one whose images move', async () => {
        const { resolver } = fakeResolver([descriptor(A)]);
        const plain: ToolResultPart = {
          type: 'tool-result',
          toolCallId: 'call-0',
          toolName: 'read',
          output: {
            type: 'content',
            value: [{ type: 'text', text: 'plain' }],
          },
        };
        const read = readResult('call-1', A);
        if (read.role !== 'tool') throw new Error('expected a tool message');

        const composed = await composeStepMessages(
          [{ role: 'tool', content: [plain, ...read.content] }],
          { resolver, context: VISION, moveToolMedia: true },
        );

        expect(composed).toEqual([
          {
            role: 'tool',
            content: [
              plain,
              expect.objectContaining({ toolCallId: 'call-1', output: moved }),
            ],
          },
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Files from tool results:' },
              label(A),
              image(0x61),
            ],
          },
        ]);
      });

      it('says the image follows when the tool message would carry no text', async () => {
        const { resolver } = fakeResolver([descriptor(A)]);
        const composed = await composeStepMessages(
          [
            {
              role: 'tool',
              content: [
                {
                  type: 'tool-result',
                  toolCallId: 'call-1',
                  toolName: 'view',
                  output: toolResultOutput('', A),
                },
              ],
            },
          ],
          { resolver, context: VISION, moveToolMedia: true },
        );

        expect(outputOf(composed[0])).toEqual({
          type: 'text',
          value: 'The files follow in the next message.',
        });
        expect(composed[1]?.content).toEqual([
          { type: 'text', text: 'Files from tool results:' },
          { type: 'text', text: `Image from view "media://${A}":` },
          image(0x61),
        ]);
      });

      it('keeps the limit placeholder in the tool message and adds no image message for it', async () => {
        const modelByteSize = EPOCH_MAX_BASE64_BYTES / 2;
        const { resolver, loads } = fakeResolver([
          descriptor(A, { modelByteSize }),
          descriptor(B, { modelByteSize }),
        ]);
        const composed = await composeStepMessages(
          [{ role: 'user', content: [fileRef(A)] }, readResult('call-1', B)],
          { resolver, context: VISION, moveToolMedia: true },
        );

        expect(loads).toEqual([A]);
        expect(composed).toHaveLength(2);
        expect(outputOf(composed[1])).toEqual({
          type: 'text',
          value: `${ENVELOPE}\n[image media://${B} 0b.png 1600×900, not attached: this context's image limit is reached]`,
        });
        // The owner attachment is still sent as an image on that wire.
        expect(composed[0]?.content).toContainEqual(
          expect.objectContaining({ type: 'image' }),
        );
      });
    });

    it('admits read images into the same window as attachments, oldest first', async () => {
      const modelByteSize = EPOCH_MAX_BASE64_BYTES / 2;
      const { resolver, loads } = fakeResolver([
        descriptor(A, { modelByteSize }),
        descriptor(B, { modelByteSize }),
      ]);
      const composed = await composeStepMessages(
        [readResult('call-1', A), readResult('call-2', B)],
        { resolver, context: VISION },
      );

      expect(loads).toEqual([A]);
      expect(outputOf(composed[0])).toMatchObject({ type: 'content' });
      expect(outputOf(composed[1])).toEqual({
        type: 'text',
        value: `${ENVELOPE}\n[image media://${B} 0b.png 1600×900, not attached: this context's image limit is reached]`,
      });
    });

    it('projects a stored read image result replayed by buildContext', async () => {
      const stored: StoredMessage = {
        id: 'msg-1',
        chatId: 'chat-1',
        seq: 1,
        role: 'assistant',
        senderUserId: null,
        attachments: [],
        createdAt: new Date(0),
        parts: [
          {
            type: 'tool-read',
            toolCallId: 'call-1',
            state: 'output-available',
            input: { path: '/work/shot.png' },
            output: {
              status: 'success',
              kind: 'image',
              media: `media://${A}`,
              mediaType: 'image/png',
              width: 1600,
              height: 900,
              path: '/work/shot.png',
            },
            outcome: 'success',
          },
        ],
      };
      const { messages } = buildContext([stored], {
        systemPrompt: 'system',
        requestKind: 'continuation',
      });
      const composed = await composeStepMessages(messages, {
        resolver: fakeResolver([descriptor(A)]).resolver,
        context: VISION,
      });

      expect(
        outputOf(composed.find((message) => message.role === 'tool')),
      ).toMatchObject({
        type: 'content',
        value: [{ type: 'text' }, { type: 'image-data' }],
      });
    });

    it('is idempotent over composed tool outputs and leaves other tool results alone', async () => {
      const { resolver } = fakeResolver([descriptor(A)]);
      const textResult: ModelMessage = {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'call-0',
            toolName: 'read',
            output: { type: 'text', value: 'plain' },
          },
        ],
      };
      const options = { resolver, context: VISION } as const;
      const once = await composeStepMessages(
        [textResult, readResult('call-1', A)],
        options,
      );
      expect(once[0]).toBe(textResult);
      expect(await composeStepMessages(once, options)).toBe(once);
    });

    it('projects every result of a tool message and leaves a content result without references as is', async () => {
      const { resolver } = fakeResolver([descriptor(A)]);
      const plain: ToolResultPart = {
        type: 'tool-result',
        toolCallId: 'call-0',
        toolName: 'read',
        output: { type: 'content', value: [{ type: 'text', text: 'plain' }] },
      };
      const image = readResult('call-1', A);
      if (image.role !== 'tool') throw new Error('Expected a tool message');

      const [composed] = await composeStepMessages(
        [{ role: 'tool', content: [plain, ...image.content] }],
        { resolver, context: VISION },
      );

      expect(composed?.content[0]).toBe(plain);
      expect(composed?.content[1]).toMatchObject({
        output: {
          type: 'content',
          value: [{ type: 'text', text: ENVELOPE }, { type: 'image-data' }],
        },
      });
    });
  });
  describe('unstored read PDFs', () => {
    const ENVELOPE = '{"status":"success","kind":"pdf","path":"report.pdf"}';
    const bytes = Buffer.from('%PDF-opaque-test-bytes');

    it.each([
      [
        'an http URL without its query or fragment',
        'http://example.test/read/report.pdf?download=1#page=2',
        'report.pdf',
      ],
      [
        'a host path with an embedded https:// segment',
        '/work/https://example.test/read/report.pdf',
        'report.pdf',
      ],
      ['a URL root', 'http://example.test/', 'document.pdf'],
    ])(
      'attaches %s with the derived filename',
      async (_, locator, filename) => {
        const { resolver } = fakeResolver([]);
        resolver.heldMedia.set('call-1', {
          locator,
          pages: 1,
          bytes,
          byteSize: bytes.byteLength,
        });

        const [composed] = await composeStepMessages(
          [
            {
              role: 'tool',
              content: [
                {
                  type: 'tool-result',
                  toolCallId: 'call-1',
                  toolName: 'read',
                  output: toolResultOutput(ENVELOPE, { locator, pages: 1 }),
                },
              ],
            },
          ],
          { resolver, context: VISION_PDF },
        );

        expect(
          composed?.role === 'tool' &&
            composed.content[0]?.type === 'tool-result'
            ? composed.content[0].output
            : undefined,
        ).toMatchObject({
          type: 'content',
          value: [
            { type: 'text', text: ENVELOPE },
            {
              type: 'file-data',
              mediaType: 'application/pdf',
              filename,
            },
          ],
        });
      },
    );
  });

  describe('unstored read images', () => {
    const ENVELOPE =
      '{"status":"success","kind":"image","path":"/work/shot.png"}';
    const SHOT = { locator: '/work/shot.png', width: 1600, height: 900 };
    const NOT_RETAINED = '[image "/work/shot.png" 1600×900, not retained]';
    const OMITTED =
      '[image "/work/shot.png" 1600×900, omitted: this model has no image input]';
    const variant = (byteLength = 3): RetainedVariant => ({
      bytes: Buffer.alloc(byteLength, 7),
      mediaType: 'image/png',
      width: 1600,
      height: 900,
    });
    const held = (
      model: RetainedVariant | undefined,
      image = SHOT,
    ): HeldMedia => ({ ...image, ...(model && { model }) });
    const unstoredResult = (
      toolCallId: string,
      image = SHOT,
    ): ModelMessage => ({
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId,
          toolName: 'read',
          output: toolResultOutput(ENVELOPE, image),
        },
      ],
    });
    const outputOf = (message: ModelMessage | undefined) =>
      message?.role === 'tool' && message.content[0]?.type === 'tool-result'
        ? message.content[0].output
        : undefined;
    const vision = { context: VISION } as const;

    it('attaches a read image from the attempt memory without any store read', async () => {
      const { resolver, loads } = fakeResolver([]);
      resolver.heldMedia.set('call-1', held(variant()));

      const [composed] = await composeStepMessages([unstoredResult('call-1')], {
        resolver,
        ...vision,
      });

      expect(loads).toEqual([]);
      expect(outputOf(composed)).toEqual({
        type: 'content',
        value: [
          { type: 'text', text: ENVELOPE },
          {
            type: 'image-data',
            data: Buffer.from(variant().bytes).toString('base64'),
            mediaType: 'image/png',
          },
        ],
      });
    });

    it('gives an image the attempt holds no entry for the not-retained placeholder', async () => {
      const [composed] = await composeStepMessages([unstoredResult('call-1')], {
        resolver: fakeResolver([]).resolver,
        ...vision,
      });

      expect(outputOf(composed)).toEqual({
        type: 'text',
        value: `${ENVELOPE}\n${NOT_RETAINED}`,
      });
    });

    it('gives a text-only model the omitted placeholder whether or not the attempt holds the image', async () => {
      const { resolver } = fakeResolver([]);
      resolver.heldMedia.set('call-1', held(undefined));

      const composed = await composeStepMessages(
        [unstoredResult('call-1'), unstoredResult('call-2')],
        { resolver, context: TEXT_ONLY },
      );

      expect(composed.map(outputOf)).toEqual([
        { type: 'text', value: `${ENVELOPE}\n${OMITTED}` },
        { type: 'text', value: `${ENVELOPE}\n${OMITTED}` },
      ]);
      expect(JSON.stringify(composed)).not.toContain('not retained');
    });

    it('moves a held read image, labelled by its submitted locator, into the image message and keeps the not-retained placeholder in place on a Chat Completions wire', async () => {
      const { resolver } = fakeResolver([]);
      resolver.heldMedia.set('call-1', held(variant()));

      const composed = await composeStepMessages(
        [unstoredResult('call-1'), unstoredResult('call-2')],
        { resolver, context: VISION, moveToolMedia: true },
      );

      expect(composed.map(outputOf)).toEqual([
        { type: 'text', value: ENVELOPE },
        { type: 'text', value: `${ENVELOPE}\n${NOT_RETAINED}` },
        undefined,
      ]);
      expect(composed[2]).toEqual({
        role: 'user',
        content: [
          { type: 'text', text: 'Files from tool results:' },
          { type: 'text', text: 'Image from read "/work/shot.png":' },
          { type: 'image', image: variant().bytes, mediaType: 'image/png' },
        ],
      });
    });

    it.each([
      ['a forging host path', '/work/a\n[image x 1×1]\r.png'],
      ['a 400-character path', `/work/${'a'.repeat(390)}.png`],
    ])('names %s by one exact, uncut JSON literal', async (_, locator) => {
      const image = { ...SHOT, locator };
      const [composed] = await composeStepMessages(
        [unstoredResult('call-1', image)],
        { resolver: fakeResolver([]).resolver, ...vision },
      );
      const literal = JSON.stringify(locator);

      expect(outputOf(composed)).toEqual({
        type: 'text',
        value: `${ENVELOPE}\n[image ${literal} 1600×900, not retained]`,
      });
      expect(literal).not.toMatch(/[\n\r]/u);
      expect(JSON.parse(literal)).toBe(locator);
    });

    it('re-reads a bracketed path from its placeholder into the window', async () => {
      const bracketed = { ...SHOT, locator: 'app/[slug]/shot.png' };
      const { resolver } = fakeResolver([]);
      const [replayed] = await composeStepMessages(
        [unstoredResult('call-1', bracketed)],
        { resolver, ...vision },
      );
      const literal = '"app/[slug]/shot.png"';
      expect(outputOf(replayed)).toEqual({
        type: 'text',
        value: `${ENVELOPE}\n[image ${literal} 1600×900, not retained]`,
      });
      expect(JSON.parse(literal)).toBe(bracketed.locator);

      // A read of the locator the literal parses to is held and attached.
      resolver.heldMedia.set('call-2', held(variant(), bracketed));
      const composed = await composeStepMessages(
        [
          unstoredResult('call-1', bracketed),
          unstoredResult('call-2', bracketed),
        ],
        { resolver, ...vision },
      );

      expect(outputOf(composed[1])).toMatchObject({
        type: 'content',
        value: [{ type: 'text' }, { type: 'image-data' }],
      });
    });

    it('drops for good the bytes of a read the window refuses on entry', async () => {
      const { resolver } = fakeResolver([]);
      const half = variant((EPOCH_MAX_BASE64_BYTES * 3) / 8 + 3);
      resolver.heldMedia.set('call-1', held(half));
      resolver.heldMedia.set('call-2', held(half));
      const messages = [unstoredResult('call-1'), unstoredResult('call-2')];

      const first = await composeStepMessages(messages, {
        resolver,
        ...vision,
      });
      const again = await composeStepMessages(messages, {
        resolver,
        ...vision,
      });

      expect(heldImageModel(resolver, 'call-1')).toBe(half);
      // The released entry keeps the size the window refused, not the bytes.
      expect(resolver.heldMedia.get('call-2')).toEqual({
        ...SHOT,
        modelByteSize: half.bytes.byteLength,
      });
      for (const composed of [first, again]) {
        expect(outputOf(composed[0])).toMatchObject({ type: 'content' });
        expect(outputOf(composed[1])).toEqual({
          type: 'text',
          value: `${ENVELOPE}\n[image "/work/shot.png" 1600×900, not attached: this context's image limit is reached]`,
        });
      }
    });

    it('gives an attached entry without bytes the not-retained placeholder rather than failing', async () => {
      const { resolver } = fakeResolver([]);
      resolver.heldMedia.set('call-1', { ...SHOT, modelByteSize: 3 });

      const [composed] = await composeStepMessages([unstoredResult('call-1')], {
        resolver,
        ...vision,
      });

      expect(outputOf(composed)).toEqual({
        type: 'text',
        value: `${ENVELOPE}\n${NOT_RETAINED}`,
      });
    });

    it('holds none of a superseded attempt in a new one, even in the same process', async () => {
      const failed = fakeResolver([]).resolver;
      failed.heldMedia.set('call-1', held(variant()));
      const retry = fakeResolver([]).resolver;
      const messages = [unstoredResult('call-1')];

      const [inFailed] = await composeStepMessages(messages, {
        resolver: failed,
        ...vision,
      });
      const [inRetry] = await composeStepMessages(messages, {
        resolver: retry,
        ...vision,
      });
      retry.heldMedia.set('call-2', held(variant()));
      const reread = await composeStepMessages(
        [...messages, unstoredResult('call-2')],
        { resolver: retry, ...vision },
      );

      expect(outputOf(inFailed)).toMatchObject({ type: 'content' });
      expect(outputOf(inRetry)).toEqual({
        type: 'text',
        value: `${ENVELOPE}\n${NOT_RETAINED}`,
      });
      expect(outputOf(reread[0])).toEqual(outputOf(inRetry));
      expect(outputOf(reread[1])).toMatchObject({
        type: 'content',
        value: [{ type: 'text' }, { type: 'image-data' }],
      });
    });

    it("frees a failed attempt's window space for the retry's own read", async () => {
      const owner = Array.from(
        { length: 99 },
        (_, n) => `0192f3a4-5b6c-7d8e-9f01-${String(n).padStart(12, '0')}`,
      );
      const { resolver } = fakeResolver(owner.map((id) => descriptor(id)));
      resolver.heldMedia.set('call-2', held(variant()));

      const composed = await composeStepMessages(
        [
          { role: 'user', content: owner.map(fileRef) },
          unstoredResult('call-1'),
          unstoredResult('call-2'),
        ],
        { resolver, ...vision },
      );

      expect(
        JSON.stringify(composed[0]).match(/"type":"image"/gu),
      ).toHaveLength(99);
      expect(outputOf(composed[1])).toEqual({
        type: 'text',
        value: `${ENVELOPE}\n${NOT_RETAINED}`,
      });
      expect(outputOf(composed[2])).toMatchObject({
        type: 'content',
        value: [{ type: 'text' }, { type: 'image-data' }],
      });
    });

    it.each([
      [true, VISION, NOT_RETAINED],
      [false, TEXT_ONLY, OMITTED],
    ])(
      'replays a stored read image of an earlier turn to a model with image input %s as its placeholder, without the thumbnail',
      async (_, context, placeholder) => {
        const stored: StoredMessage = {
          id: 'msg-1',
          chatId: 'chat-1',
          seq: 1,
          role: 'assistant',
          senderUserId: null,
          attachments: [],
          createdAt: new Date(0),
          parts: [
            {
              type: 'tool-read',
              toolCallId: 'call-1',
              state: 'output-available',
              input: { path: '/work/shot.png' },
              output: {
                status: 'success',
                kind: 'image',
                mediaType: 'image/png',
                width: 1600,
                height: 900,
                path: '/work/shot.png',
                thumbnail: 'data:image/webp;base64,UklGRg==',
              },
              outcome: 'success',
            },
          ],
        };
        const { messages } = buildContext([stored], {
          systemPrompt: 'system',
          requestKind: 'continuation',
        });
        const composed = await composeStepMessages(messages, {
          resolver: fakeResolver([]).resolver,
          context,
        });
        const output = outputOf(
          composed.find((message) => message.role === 'tool'),
        );

        expect(output?.type).toBe('text');
        expect(JSON.stringify(output)).toContain(
          JSON.stringify(placeholder).slice(1, -1),
        );
        expect(JSON.stringify(composed)).not.toContain('thumbnail');
        expect(JSON.stringify(composed)).not.toContain('UklGRg');
      },
    );
  });
});

const ZERO_USAGE = {
  inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 0, text: 0, reasoning: 0 },
};

function toolStep(toolCallId: string): Array<LanguageModelV3StreamPart> {
  return [
    { type: 'tool-call', toolCallId, toolName: 'noop', input: '{}' },
    {
      type: 'finish',
      finishReason: { unified: 'tool-calls', raw: undefined },
      usage: ZERO_USAGE,
    },
  ];
}

const TEXT_STEP: Array<LanguageModelV3StreamPart> = [
  { type: 'text-start', id: 't' },
  { type: 'text-delta', id: 't', delta: 'ok' },
  { type: 'text-end', id: 't' },
  {
    type: 'finish',
    finishReason: { unified: 'stop', raw: undefined },
    usage: ZERO_USAGE,
  },
];

/** A model that answers `ok` once per step and records each provider prompt. */
function recordingModel(steps: Array<'tool' | 'text'> = ['text']) {
  const prompts: Array<LanguageModelV3CallOptions['prompt']> = [];
  const model = new MockLanguageModelV3({
    doStream: ({ prompt }) => {
      const step = steps[prompts.length] ?? 'text';
      prompts.push(prompt);
      return Promise.resolve({
        stream: simulateReadableStream({
          chunks:
            step === 'tool' ? toolStep(`call-${prompts.length}`) : TEXT_STEP,
        }),
      });
    },
  });
  return { model, prompts };
}

/** The `data` of a provider prompt's user file parts. */
function promptFileData(prompt: LanguageModelV3CallOptions['prompt']) {
  return prompt.flatMap((message) =>
    message.role === 'user'
      ? message.content.flatMap((part) =>
          part.type === 'file' ? [part.data] : [],
        )
      : [],
  );
}

describe('installStepPreparation', () => {
  it('composes a tool-less request, so no media reference reaches the provider', async () => {
    const { resolver } = fakeResolver([descriptor(A)]);
    const { model, prompts } = recordingModel();
    const input: ModelStreamInput = {
      chat: CHAT,
      messages: [
        { role: 'user', content: [fileRef(A), { type: 'text', text: 'hi' }] },
      ],
      media: resolver,
    };
    const streamOptions = { model, messages: input.messages };
    installStepPreparation(streamOptions, input, {
      input: ['text', 'image'],
      ...WINDOW,
    });

    await expect(streamText(streamOptions).text).resolves.toBe('ok');

    // Only bytes reach the provider: no file part carries a `media://` string.
    expect(promptFileData(prompts[0] ?? [])).toEqual([new Uint8Array([0x61])]);
  });

  it('leaves messages as they are without a resolver and calls no tool hook without tools', async () => {
    const { model, prompts } = recordingModel();
    const onStepStart = vi.fn();
    const input: ModelStreamInput = {
      chat: CHAT,
      messages: [{ role: 'user', content: 'hello' }],
      onStepStart,
    };
    const streamOptions = { model, messages: input.messages };
    installStepPreparation(streamOptions, input, WINDOW);

    await expect(streamText(streamOptions).text).resolves.toBe('ok');

    expect(onStepStart).not.toHaveBeenCalled();
    expect(prompts).toHaveLength(1);
  });

  it('composes the onStepStart override after the step cap disables tools', async () => {
    const { resolver } = fakeResolver([descriptor(A)]);
    const { model, prompts } = recordingModel(['tool', 'text']);
    const onCapReached = vi.fn();
    const seen: Array<Array<ModelMessage>> = [];
    const input: ModelStreamInput = {
      chat: CHAT,
      messages: [{ role: 'user', content: 'start' }],
      tools: {
        noop: tool({ inputSchema: z.object({}), execute: () => 'done' }),
      },
      maxSteps: 1,
      media: resolver,
      onCapReached,
      onStepStart: ({ messages }) => {
        seen.push(messages);
        return [...messages, { role: 'user', content: [fileRef(A)] }];
      },
    };
    const streamOptions = {
      model,
      messages: input.messages,
      tools: input.tools,
      stopWhen: stepCountIs(2),
    };
    installStepPreparation(streamOptions, input, {
      input: ['text', 'image'],
      ...WINDOW,
    });

    await expect(streamText(streamOptions).text).resolves.toBe('ok');

    // The hook saw the untransformed messages on every step.
    expect(JSON.stringify(seen)).not.toContain('"type":"image"');
    expect(onCapReached).toHaveBeenCalledOnce();
    expect(prompts).toHaveLength(2);
    for (const prompt of prompts) {
      expect(promptFileData(prompt)).toEqual([new Uint8Array([0x61])]);
    }
  });

  describe('reads inside a Run', () => {
    const IDS = [1, 2, 3, 4, 5, 6].map(
      (n) => `0192f3a4-5b6c-7d8e-9f01-0000000000a${n}`,
    );
    // Each base64 variant is 5 MiB, so five fit the 28 MiB bound.
    const modelByteSize = (5 * 2 ** 20 * 3) / 4;

    /** A Run that reads `IDS` one per step and then answers. */
    async function readSix(moveToolMedia?: boolean) {
      const { resolver } = fakeResolver(
        IDS.map((id) => descriptor(id, { modelByteSize })),
      );
      const { model, prompts } = recordingModel(IDS.map(() => 'tool' as const));
      let reads = 0;
      const input: ModelStreamInput = {
        chat: CHAT,
        messages: [{ role: 'user', content: 'read them' }],
        tools: {
          noop: tool({
            inputSchema: z.object({}),
            execute: () => ({ media: `media://${IDS[reads++]}` }),
            toModelOutput: ({ output }) =>
              toolResultOutput('envelope', output.media.slice(8)),
          }),
        },
        media: resolver,
      };
      const streamOptions = {
        model,
        messages: input.messages,
        tools: input.tools,
        stopWhen: stepCountIs(7),
      };
      installStepPreparation(
        streamOptions,
        input,
        { input: ['text', 'image'], ...WINDOW },
        { moveToolMedia },
      );
      await expect(streamText(streamOptions).text).resolves.toBe('ok');
      return prompts;
    }

    /** The tool-result outputs of a provider prompt, in order. */
    function toolOutputs(prompt: LanguageModelV3CallOptions['prompt']) {
      return prompt.flatMap((message) =>
        message.role === 'tool'
          ? message.content.flatMap((part) =>
              part.type === 'tool-result' ? [part.output] : [],
            )
          : [],
      );
    }

    it('sends every read in the window as image content and only the newest past the bounds as the limit placeholder', async () => {
      const prompts = await readSix();

      expect(prompts).toHaveLength(7);
      const last = toolOutputs(prompts[6] ?? []);
      expect(last.slice(0, 5)).toEqual(
        IDS.slice(0, 5).map((id) => ({
          type: 'content',
          value: [
            { type: 'text', text: 'envelope' },
            {
              type: 'image-data',
              data: Buffer.from([id.codePointAt(35) ?? 0]).toString('base64'),
              mediaType: 'image/png',
            },
          ],
        })),
      );
      expect(last[5]).toEqual({
        type: 'text',
        value: `envelope\n[image media://${IDS[5]} a6.png 1600×900, not attached: this context's image limit is reached]`,
      });
      // Each step projects the same prefix: earlier steps attached the same reads.
      expect(toolOutputs(prompts[5] ?? [])).toEqual(last.slice(0, 5));
    });

    it('retains only the reads the window admits, and the next turn retains none', async () => {
      const { resolver } = fakeResolver([]);
      const { model, prompts } = recordingModel(
        Array.from({ length: 10 }, () => 'tool' as const),
      );
      const image = (toolCallId: string) => ({
        locator: `/work/${toolCallId}.png`,
        width: 1600,
        height: 900,
      });
      const input: ModelStreamInput = {
        chat: CHAT,
        messages: [{ role: 'user', content: 'read them' }],
        tools: {
          noop: tool({
            inputSchema: z.object({}),
            // What the read hook does: hold the decoded variant in the attempt.
            execute: (_, { toolCallId }) => {
              resolver.heldMedia.set(toolCallId, {
                ...image(toolCallId),
                model: {
                  bytes: Buffer.alloc(modelByteSize),
                  mediaType: 'image/png',
                  width: 1600,
                  height: 900,
                },
              });
              return 'read';
            },
            toModelOutput: ({ toolCallId }) =>
              toolResultOutput('envelope', image(toolCallId)),
          }),
        },
        media: resolver,
      };
      const streamOptions = {
        model,
        messages: input.messages,
        tools: input.tools,
        stopWhen: stepCountIs(11),
      };
      installStepPreparation(streamOptions, input, {
        input: ['text', 'image'],
        ...WINDOW,
      });
      const result = streamText(streamOptions);
      await expect(result.text).resolves.toBe('ok');

      const calls = Array.from({ length: 10 }, (_, n) => `call-${n + 1}`);
      const retained = calls.filter(
        (call) => heldImageModel(resolver, call) !== undefined,
      );
      expect(retained).toEqual(calls.slice(0, 5));
      const retainedBase64 = retained.map(
        (call) =>
          4 *
          Math.ceil((heldImageModel(resolver, call)?.bytes.length ?? 0) / 3),
      );
      expect(retainedBase64.reduce((sum, size) => sum + size, 0)).toBe(
        5 * 5 * 2 ** 20,
      );
      const last = toolOutputs(prompts[10] ?? []);
      expect(last.slice(0, 5).map((output) => output.type)).toEqual(
        calls.slice(0, 5).map(() => 'content'),
      );
      expect(last.slice(5)).toEqual(
        calls.slice(5).map((call) => ({
          type: 'text',
          value: `envelope\n[image "/work/${call}.png" 1600×900, not attached: this context's image limit is reached]`,
        })),
      );

      // The next turn is another attempt: every read is not retained.
      const next = await composeStepMessages(
        [...input.messages, ...(await result.response).messages],
        {
          resolver: fakeResolver([]).resolver,
          context: VISION,
        },
      );
      expect(JSON.stringify(next).match(/not retained/gu)).toHaveLength(10);
      expect(JSON.stringify(next)).not.toContain('image-data');
    });

    it('sends each read in the window in one image message after its tool message on a Chat Completions wire', async () => {
      const prompts = await readSix(true);

      expect(prompts).toHaveLength(7);
      const imageMessage = (id: string) => ({
        role: 'user',
        content: [
          { type: 'text', text: 'Files from tool results:' },
          { type: 'text', text: `Image from noop "media://${id}":` },
          expect.objectContaining({
            type: 'file',
            data: new Uint8Array([id.codePointAt(35) ?? 0]),
            mediaType: 'image/png',
          }),
        ],
      });
      /** What follows each tool message of a provider prompt, in order. */
      const afterTools = (prompt: LanguageModelV3CallOptions['prompt']) =>
        prompt.flatMap((message, at) =>
          message.role === 'tool' ? [prompt[at + 1]] : [],
        );
      // Every step after a read carries exactly one image message per read.
      for (const [step, prompt] of prompts.slice(1, 6).entries()) {
        expect(afterTools(prompt)).toEqual(
          IDS.slice(0, step + 1).map((id) => imageMessage(id)),
        );
      }
      const last = prompts[6] ?? [];
      expect(afterTools(last)).toEqual([
        ...IDS.slice(0, 5).map((id) => imageMessage(id)),
        undefined,
      ]);
      expect(toolOutputs(last)).toEqual(
        IDS.map((id, index) => ({
          type: 'text',
          value:
            index < 5
              ? 'envelope'
              : `envelope\n[image media://${id} a6.png 1600×900, not attached: this context's image limit is reached]`,
        })),
      );
    });
  });

  it('treats a model without declared input as text-only', async () => {
    const { resolver, loads } = fakeResolver([descriptor(A)]);
    const { model, prompts } = recordingModel();
    const input: ModelStreamInput = {
      chat: CHAT,
      messages: [{ role: 'user', content: [fileRef(A)] }],
      media: resolver,
    };
    const streamOptions = { model, messages: input.messages };
    installStepPreparation(streamOptions, input, WINDOW);

    await expect(streamText(streamOptions).text).resolves.toBe('ok');

    expect(promptFileData(prompts[0] ?? [])).toEqual([]);
    expect(JSON.stringify(prompts[0])).toContain(
      'omitted: this model has no image input',
    );
    expect(loads).toEqual([]);
  });

  it.each([
    { reservedOutputTokens: undefined, pages: 53, attached: true },
    { reservedOutputTokens: 64_000, pages: 33, attached: false },
    { reservedOutputTokens: 64_000, pages: 32, attached: true },
  ])(
    'bounds PDF pages by the client window less a $reservedOutputTokens reserve: $pages pages attached $attached',
    async ({ reservedOutputTokens, pages, attached }) => {
      const { resolver } = fakeResolver([pdfDescriptor(A, { pages })]);
      const { model, prompts } = recordingModel();
      const input: ModelStreamInput = {
        chat: CHAT,
        messages: [{ role: 'user', content: [pdfRef(A)] }],
        media: resolver,
        ...(reservedOutputTokens !== undefined && { reservedOutputTokens }),
      };
      const streamOptions = { model, messages: input.messages };
      installStepPreparation(streamOptions, input, {
        input: ['text', 'pdf'],
        contextWindowTokens: 200_000,
      });

      await expect(streamText(streamOptions).text).resolves.toBe('ok');

      expect(promptFileData(prompts[0] ?? [])).toHaveLength(attached ? 1 : 0);
    },
  );
});

describe('installStepPreparation step cap', () => {
  const toolStepResult = { toolCalls: [{ toolName: 'noop' }] };
  const textStepResult = { toolCalls: [] };

  /** The installed `prepareStep` result after `steps` prior steps. */
  async function prepare(
    input: Partial<ModelStreamInput>,
    steps: ReadonlyArray<{ toolCalls: ReadonlyArray<unknown> }>,
  ) {
    const onCapReached = vi.fn();
    const streamOptions: Parameters<typeof streamText>[0] = {
      model: recordingModel().model,
      messages: [],
    };
    installStepPreparation(
      streamOptions,
      { chat: CHAT, messages: [], onCapReached, ...input },
      WINDOW,
    );
    // SAFETY: the installed `prepareStep` reads only `messages`, `stepNumber`
    // and each prior step's `toolCalls`, which these stand-ins carry.
    // eslint-disable-next-line typescript/no-unsafe-type-assertion
    const args = { messages: [], stepNumber: steps.length, steps } as never;
    const result = await streamOptions.prepareStep?.(args);
    return { result, onCapReached };
  }

  const tools = {
    noop: tool({ inputSchema: z.object({}), execute: () => 'done' }),
  };

  it('keeps tools until maxSteps prior steps requested one', async () => {
    const { result, onCapReached } = await prepare({ tools, maxSteps: 1 }, []);

    expect(result).toEqual({});
    expect(onCapReached).not.toHaveBeenCalled();
  });

  it('declares no tools once maxSteps prior steps requested one', async () => {
    const { result, onCapReached } = await prepare({ tools, maxSteps: 1 }, [
      toolStepResult,
    ]);

    expect(result).toEqual({ activeTools: [] });
    expect(onCapReached).toHaveBeenCalledOnce();
  });

  it('counts only the prior steps that requested a tool', async () => {
    const { result, onCapReached } = await prepare({ tools, maxSteps: 2 }, [
      textStepResult,
      toolStepResult,
    ]);

    expect(result).toEqual({});
    expect(onCapReached).not.toHaveBeenCalled();
  });

  it('never reaches a cap without tools', async () => {
    const { result, onCapReached } = await prepare({ maxSteps: 0 }, []);

    expect(result).toEqual({});
    expect(onCapReached).not.toHaveBeenCalled();
  });

  it('never reaches a cap without maxSteps', async () => {
    const { result, onCapReached } = await prepare({ tools }, [toolStepResult]);

    expect(result).toEqual({});
    expect(onCapReached).not.toHaveBeenCalled();
  });
});
