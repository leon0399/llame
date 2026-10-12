import type { ModelMessage } from 'ai';

import {
  admitEpochImages,
  collectMediaRefs,
  EPOCH_MAX_BASE64_BYTES,
  EPOCH_MAX_IMAGES,
  imageResultRef,
  loadMediaSizing,
  submittedLocator,
  toolResultOutput,
  userImagePart,
} from './epoch-admission';
import { descriptor, fakeResolver } from './media-fixtures';
import type { MediaDescriptor } from './media-descriptors';

const SHOT = { locator: '/work/shot.png', width: 1600, height: 900 };

/** A canonical media id whose last block is `n`. */
function mediaId(n: number): string {
  return `0192f3a4-5b6c-7d8e-9f01-${n.toString(16).padStart(12, '0')}`;
}

function descriptorMap(
  entries: ReadonlyArray<MediaDescriptor>,
): ReadonlyMap<string, MediaDescriptor> {
  return new Map(entries.map((entry) => [entry.id, entry]));
}

const range = (count: number) => Array.from({ length: count }, (_, n) => n);

/** Raw bytes whose base64 form is exactly 5 MiB. */
const FIVE_MIB_BASE64_RAW = (5 * 1024 * 1024 * 3) / 4;

describe('admitEpochImages', () => {
  it('attaches the 100 oldest images and puts the 101st at the limit', () => {
    const ids = range(101).map(mediaId);
    const statuses = admitEpochImages(
      ids,
      descriptorMap(ids.map((id) => descriptor(id))),
    );

    expect(statuses.slice(0, EPOCH_MAX_IMAGES)).toEqual(
      range(100).map(() => 'attached'),
    );
    expect(statuses[100]).toBe('limit');
  });

  it('stops at the byte bound: five 5 MiB base64 variants attach four', () => {
    const large = range(5).map(mediaId);
    const small = range(3).map((n) => mediaId(100 + n));
    const statuses = admitEpochImages(
      [...large, ...small],
      descriptorMap([
        ...large.map((id) =>
          descriptor(id, { modelByteSize: FIVE_MIB_BASE64_RAW }),
        ),
        ...small.map((id) => descriptor(id)),
      ]),
    );

    expect(statuses).toEqual([
      'attached',
      'attached',
      'attached',
      'attached',
      'limit',
      // Later small images stay out too: the first overflow latches.
      'limit',
      'limit',
      'limit',
    ]);
  });

  it('attaches a variant that fills the byte bound exactly', () => {
    const [first = '', second = ''] = range(2).map(mediaId);
    const statuses = admitEpochImages(
      [first, second],
      descriptorMap([
        descriptor(first, { modelByteSize: (EPOCH_MAX_BASE64_BYTES * 3) / 4 }),
        descriptor(second, { modelByteSize: 1 }),
      ]),
    );

    expect(statuses).toEqual(['attached', 'limit']);
  });

  it('never changes an earlier status when a reference is appended', () => {
    const ids = range(100).map(mediaId);
    const next = mediaId(500);
    const descriptors = descriptorMap(
      [...ids, next].map((id) => descriptor(id)),
    );

    const before = admitEpochImages(ids, descriptors);
    const after = admitEpochImages([...ids, next], descriptors);

    expect(after.slice(0, ids.length)).toEqual(before);
    expect(after.at(-1)).toBe('limit');
  });

  it('counts a repeated id again', () => {
    const id = mediaId(1);
    const statuses = admitEpochImages(
      range(101).map(() => id),
      descriptorMap([descriptor(id)]),
    );

    expect(statuses.filter((status) => status === 'attached')).toHaveLength(
      100,
    );
    expect(statuses[100]).toBe('limit');
  });

  it('marks unresolvable references unavailable without counting them', () => {
    const known = range(100).map(mediaId);
    const unknown = mediaId(999);
    const statuses = admitEpochImages(
      [unknown, ...known, unknown],
      descriptorMap(known.map((id) => descriptor(id))),
    );

    expect(statuses[0]).toBe('unavailable');
    expect(statuses.slice(1, 101)).toEqual(range(100).map(() => 'attached'));
    expect(statuses[101]).toBe('unavailable');
  });

  it('never counts a not-retained read: 99 attachments, an earlier read, and one more attach all 100', () => {
    const owner = range(100).map(mediaId);
    const statuses = admitEpochImages(
      [...owner.slice(0, 99), { unstored: 'not-retained' }, ...owner.slice(99)],
      descriptorMap(owner.map((id) => descriptor(id))),
    );

    expect(statuses[99]).toBe('not-retained');
    expect(statuses.filter((status) => status === 'attached')).toHaveLength(
      100,
    );
  });

  it('sizes an unstored image held with bytes like a stored one', () => {
    const held = {
      unstored: 'held',
      modelByteSize: FIVE_MIB_BASE64_RAW,
    } as const;
    const statuses = admitEpochImages(
      range(5).map(() => held),
      new Map(),
    );

    expect(statuses).toEqual([
      'attached',
      'attached',
      'attached',
      'attached',
      'limit',
    ]);
  });
});

describe('collectMediaRefs', () => {
  it('lists user file and tool-result references in request order and skips everything else', () => {
    const messages: Array<ModelMessage> = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'first' },
          {
            type: 'file',
            data: `media://${mediaId(1)}`,
            mediaType: 'image/png',
          },
          {
            type: 'file',
            data: 'https://example.test/x.png',
            mediaType: 'image/png',
          },
        ],
      },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'ok' },
          {
            type: 'file',
            data: `media://${mediaId(3)}`,
            mediaType: 'image/png',
          },
        ],
      },
      { role: 'user', content: 'plain text' },
      {
        role: 'user',
        content: [
          {
            type: 'file',
            data: `media://${mediaId(2)}`,
            mediaType: 'image/png',
          },
          {
            type: 'file',
            data: `media://${mediaId(1)}`,
            mediaType: 'image/png',
          },
        ],
      },
      {
        role: 'assistant',
        content: [
          { type: 'tool-call', toolCallId: 'c1', toolName: 'read', input: {} },
          { type: 'tool-call', toolCallId: 'c2', toolName: 'read', input: {} },
          { type: 'tool-call', toolCallId: 'c3', toolName: 'read', input: {} },
        ],
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'c1',
            toolName: 'read',
            output: toolResultOutput('envelope', mediaId(3)),
          },
          {
            type: 'tool-result',
            toolCallId: 'c2',
            toolName: 'read',
            output: {
              type: 'content',
              value: [
                { type: 'text', text: 'text' },
                { type: 'image-url', url: 'https://example.test/y.png' },
                { type: 'custom', providerOptions: { other: {} } },
              ],
            },
          },
          {
            type: 'tool-result',
            toolCallId: 'c3',
            toolName: 'read',
            output: toolResultOutput('envelope', SHOT),
          },
        ],
      },
    ];

    expect(collectMediaRefs(messages)).toEqual([
      mediaId(1),
      mediaId(2),
      mediaId(1),
      mediaId(3),
      { ...SHOT, key: 'c3' },
    ]);
  });

  it('lists prompt-import image references in place and skips byte images', () => {
    const unstored = { ...SHOT, key: 'prompt-import:run:shot.png' };
    const messages: Array<ModelMessage> = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'imports' },
          userImagePart(unstored),
          userImagePart(mediaId(5)),
          { type: 'image', image: new Uint8Array([1]), mediaType: 'image/png' },
          {
            type: 'file',
            data: `media://${mediaId(6)}`,
            mediaType: 'image/png',
          },
          { type: 'text', text: 'question' },
        ],
      },
    ];

    expect(collectMediaRefs(messages)).toEqual([
      unstored,
      mediaId(5),
      mediaId(6),
    ]);
  });
});

describe('imageResultRef', () => {
  it('names the media of a successful media image result', () => {
    const media = `media://${mediaId(4)}`;
    expect(
      imageResultRef({ status: 'success', kind: 'image', media }, 'x'),
    ).toBe(mediaId(4));
    expect(
      imageResultRef(
        { status: 'success', kind: 'image', media: `MEDIA://${mediaId(4)}` },
        'x',
      ),
    ).toBeUndefined();
  });

  it('names any other image result by its submitted locator and dimensions', () => {
    const result = {
      status: 'success',
      kind: 'image',
      mediaType: 'image/png',
      width: 1600,
      height: 900,
      path: '/host/projected/shot.png',
      thumbnail: 'data:image/webp;base64,UklGRg==',
    };
    expect(imageResultRef(result, SHOT.locator)).toEqual(SHOT);
    expect(imageResultRef(result, undefined)).toBeUndefined();
  });

  it('names nothing for a non-image or failed result', () => {
    const image = { kind: 'image', width: 1, height: 1 };
    expect(
      imageResultRef({ ...image, status: 'success', kind: 'file' }, 'x'),
    ).toBeUndefined();
    expect(imageResultRef({ ...image, status: 'error' }, 'x')).toBeUndefined();
    expect(imageResultRef('media', 'x')).toBeUndefined();
  });

  it('reads the locator a read call submitted', () => {
    expect(submittedLocator({ path: 'docs/shot.png' })).toBe('docs/shot.png');
    expect(submittedLocator({ path: 1 })).toBeUndefined();
    expect(submittedLocator(null)).toBeUndefined();
  });
});

describe('loadMediaSizing', () => {
  it('describes the stored references through the resolver and admits them', async () => {
    const { resolver, loads } = fakeResolver([descriptor(mediaId(1))]);
    const describeSpy = vi.spyOn(resolver, 'describe');

    const sizing = await loadMediaSizing(
      [
        {
          role: 'user',
          content: [
            {
              type: 'file',
              data: `media://${mediaId(1)}`,
              mediaType: 'image/png',
            },
            {
              type: 'file',
              data: `media://${mediaId(2)}`,
              mediaType: 'image/png',
            },
          ],
        },
      ],
      resolver,
      true,
    );

    expect(describeSpy).toHaveBeenCalledWith([mediaId(1), mediaId(2)]);
    expect(sizing).toMatchObject({
      refs: [mediaId(1), mediaId(2)],
      statuses: ['attached', 'unavailable'],
      imageInput: true,
    });
    expect(loads).toEqual([]);
  });

  it("admits unstored references by what the attempt's memory holds for them", async () => {
    const { resolver } = fakeResolver([]);
    const model = {
      bytes: Buffer.alloc((EPOCH_MAX_BASE64_BYTES * 3) / 4),
      mediaType: 'image/png' as const,
      width: 1600,
      height: 900,
    };
    resolver.images.set('c1', { ...SHOT, model });
    resolver.images.set('c2', { ...SHOT, model });
    const result = (toolCallId: string): ModelMessage => ({
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId,
          toolName: 'read',
          output: toolResultOutput('envelope', SHOT),
        },
      ],
    });

    const sizing = await loadMediaSizing(
      [result('c0'), result('c1'), result('c2')],
      resolver,
      true,
    );

    expect(sizing.statuses).toEqual(['not-retained', 'attached', 'limit']);
    expect([...sizing.held.keys()]).toEqual(['c1', 'c2']);
  });
});
