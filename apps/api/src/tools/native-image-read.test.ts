import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { drizzle } from 'drizzle-orm/postgres-js';
import sharp from 'sharp';
import { MEDIA_SELECTOR_MESSAGE } from '@workspace/native-file-tools';
import { z } from 'zod';

import * as schema from '../db/schema';
import type { MediaObject } from '../db/schema';
import type { Db } from '../db/tenant-db.service';
import { KNOWLEDGE_CONTENT_NOTICE } from '../knowledge/knowledge-content-notice';
import { KnowledgeFilesystemAdapter } from '../knowledge/knowledge-filesystem';
import type { RetainedMedia } from '../media/attempt-media';
import {
  MEDIA_MAX_BYTES,
  MEDIA_REFUSAL,
  prepareMedia,
  THUMBNAIL_MAX_CHARS,
} from '../media/media-ingest';
import type { MediaService } from '../media/media.service';
import { createToolMediaStore } from '../media/tool-media-store';
import { SkillCatalog } from '../skills/skill-catalog';
import { NativeFilesRepository } from '../runs/native-files-repository';
import { compileTestPermissionPolicy } from '../testing/tool-permission-policy';
import {
  nativeEditTool,
  nativeReadTool,
  nativeWriteTool,
} from './native-files';
import { compileToolPermissionMap } from './permissions/compile-permissions';
import { runTool } from './runner';
import type { ToolContext } from './types';
import { createWorkspaceRootCell } from './workspace-path';

const OWNED = '0190f5e2-7c1a-7b3e-9d4f-2a6b8c0d1e2f';
const SPACE = '6f5d8a0f-7dd3-4f6b-b6ed-9e0f0b1c2d3e';
const OTHER_SPACE = '11111111-2222-4333-8444-555555555555';

const pdfFixture = (name: string) =>
  readFile(join(__dirname, '../media/testing/pdf', name));

/** `result` with its thumbnail, checked to be a WebP data URL, set aside. */
function shown(result: unknown) {
  const { thumbnail, ...rest } = z
    .looseObject({ thumbnail: z.string() })
    .parse(result);
  expect(thumbnail).toMatch(/^data:image\/webp;base64,/u);
  return rest;
}

/** A solid PNG of the given size. */
function png(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: '#3366cc' },
  })
    .png()
    .toBuffer();
}

function mediaObject(id: string, ownerUserId: string): MediaObject {
  return {
    id,
    ownerUserId,
    name: 'shot.png',
    mediaType: 'image/png',
    width: 1600,
    height: 900,
    byteSize: 100,
    modelMediaType: 'image/png',
    modelWidth: 1600,
    modelHeight: 900,
    modelByteSize: 100,
    pageCount: null,
    sha256: 'digest',
    createdAt: new Date(0),
  };
}

type FakeMedia = {
  service: Pick<MediaService, 'findOwned'>;
  lookups: Array<string>;
};

/**
 * The owner's media through a MediaService double that can only look up:
 * `owner` holds OWNED. A read has no way to store anything through it.
 */
function fakeMedia(): FakeMedia {
  const lookups: Array<string> = [];
  const objects = [mediaObject(OWNED, 'owner')];
  return {
    lookups,
    service: {
      findOwned: (owner, id) => {
        lookups.push(id);
        return Promise.resolve(
          objects.find(
            (entry) => entry.id === id && entry.ownerUserId === owner,
          ),
        );
      },
    },
  };
}

/** The decoded image result of a 160×90 PNG, without attribution or thumbnail. */
const IMAGE = {
  status: 'success',
  kind: 'image',
  mediaType: 'image/png',
  width: 160,
  height: 90,
};

const STORED_IMAGE = {
  status: 'success',
  kind: 'image',
  media: `media://${OWNED}`,
  mediaType: 'image/png',
  width: 1600,
  height: 900,
};

describe('native media reads', () => {
  let directory: string;
  let media: FakeMedia;
  let memory: Map<string, RetainedMedia>;
  let shot: Buffer;

  function context(overrides: Partial<ToolContext> = {}): ToolContext {
    const db: Db = drizzle.mock({ schema });
    return {
      userId: 'owner',
      chatId: 'chat',
      runId: 'run',
      nativeExecutorId: 'host',
      nativeDeliverySequence: 1,
      toolCallId: 'call',
      permissionPolicy: compileTestPermissionPolicy(),
      tenantDb: {
        runAs: async <T>(_userId: string, callback: (tx: Db) => Promise<T>) =>
          callback(db),
      },
      media: createToolMediaStore(media.service, 'owner', memory),
      ...overrides,
    };
  }

  /** The attempt's retained entry for `key`, its base64 summarized. */
  function held(key = 'call') {
    const entry = memory.get(key);
    if (entry === undefined || 'pages' in entry || 'exceeded' in entry) {
      return undefined;
    }
    const { model, ...image } = entry;
    return {
      ...image,
      model: {
        mediaType: model.mediaType,
        width: model.width,
        height: model.height,
        base64: model.data.length > 0,
      },
    };
  }

  beforeAll(async () => {
    shot = await png(160, 90);
  });
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'native-image-'));
    media = fakeMedia();
    memory = new Map();
    // A host read records its attempt before reading; no prior one exists.
    vi.spyOn(NativeFilesRepository.prototype, 'begin').mockResolvedValue(
      undefined,
    );
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(directory, { recursive: true, force: true });
  });

  it('decodes a host image without storing it and holds it in the attempt', async () => {
    const path = join(directory, 'shot.png');
    await writeFile(path, shot);

    const result = await runTool(nativeReadTool, { path }, context(), 5);

    expect(shown(result)).toEqual({ ...IMAGE, path });
    expect(result).not.toHaveProperty('media');
    expect(result).not.toHaveProperty('content');
    expect(media.lookups).toEqual([]);
    expect(held()).toEqual({
      locator: path,
      width: 160,
      height: 90,
      model: {
        mediaType: 'image/png',
        width: 160,
        height: 90,
        base64: true,
      },
    });
  });

  it('returns the same envelope and keeps the variant for a model without image input', async () => {
    const path = join(directory, 'shot.png');
    await writeFile(path, shot);
    const textOnly = context({
      media: createToolMediaStore(media.service, 'owner', memory),
    });

    const result = await runTool(nativeReadTool, { path }, textOnly, 5);

    expect(shown(result)).toEqual({ ...IMAGE, path });
    expect(held()).toEqual({
      locator: path,
      width: 160,
      height: 90,
      model: {
        mediaType: 'image/png',
        width: 160,
        height: 90,
        base64: true,
      },
    });
  });

  it('prepares a read image like an upload, with a small thumbnail, and stores it nowhere', async () => {
    const wide = await png(4000, 1000);
    const path = join(directory, 'wide.png');
    await writeFile(path, wide);

    const result = await runTool(nativeReadTool, { path }, context(), 5);
    const upload = await prepareMedia(wide);

    expect(held()?.model).toMatchObject({
      width: upload.model.width,
      height: upload.model.height,
    });
    expect(upload.model).toMatchObject({ width: 2000, height: 500 });
    const { thumbnail: url } = z
      .object({ thumbnail: z.string() })
      .parse(result);
    expect(url.length).toBeLessThanOrEqual(THUMBNAIL_MAX_CHARS);
    const thumbnail = await sharp(
      Buffer.from(url.split(',')[1] ?? '', 'base64'),
    ).metadata();
    expect(thumbnail).toMatchObject({ format: 'webp', width: 256, height: 64 });
    expect(media.lookups).toEqual([]);
  });

  it('holds a Workspace-relative image under the submitted path and reports its projected path', async () => {
    await mkdir(join(directory, 'app', '[slug]'), { recursive: true });
    await writeFile(join(directory, 'app', '[slug]', 'shot.png'), shot);

    const result = await runTool(
      nativeReadTool,
      { path: 'app/[slug]/shot.png' },
      context({ workspaceRoot: createWorkspaceRootCell(directory) }),
      5,
    );

    expect(shown(result)).toEqual({
      ...IMAGE,
      path: join(directory, 'app', '[slug]', 'shot.png'),
    });
    expect(held()?.locator).toBe('app/[slug]/shot.png');
  });

  it('holds a file: alias image under the submitted URL and reports its host path', async () => {
    const path = join(directory, 'shot.png');
    await writeFile(path, shot);
    const submitted = `file://${path}`;

    expect(
      shown(await runTool(nativeReadTool, { path: submitted }, context(), 5)),
    ).toEqual({ ...IMAGE, path });
    expect(held()?.locator).toBe(submitted);
  });

  it('decodes a re-read afresh under its own call', async () => {
    const path = join(directory, 'shot.png');
    await writeFile(path, shot);
    await runTool(nativeReadTool, { path }, context({ toolCallId: 'one' }), 5);
    await writeFile(path, await png(320, 180));

    expect(
      shown(
        await runTool(
          nativeReadTool,
          { path },
          context({ toolCallId: 'two' }),
          5,
        ),
      ),
    ).toEqual({ ...IMAGE, width: 320, height: 180, path });
    expect(held('one')).toMatchObject({ width: 160, height: 90 });
    expect(held('two')).toMatchObject({ width: 320, height: 180 });
  });

  it('refuses an image over 20 MiB without reading it', async () => {
    const path = join(directory, 'huge.png');
    await writeFile(path, Buffer.concat([shot, Buffer.alloc(21 * 2 ** 20)]));

    expect(await runTool(nativeReadTool, { path }, context(), 5)).toEqual({
      status: 'error',
      type: 'media_too_large',
      message: MEDIA_REFUSAL.imageTooLarge.message,
    });
    expect(held()).toBeUndefined();
  });

  it('refuses an image whose header declares more than 40 megapixels', async () => {
    const path = join(directory, 'vast.png');
    await writeFile(path, await png(8000, 5200));

    expect(await runTool(nativeReadTool, { path }, context(), 5)).toEqual({
      status: 'error',
      type: 'media_too_large',
      message: MEDIA_REFUSAL.imageTooLarge.message,
    });
    expect(held()).toBeUndefined();
  });

  it('refuses an undecodable signature match with no text and no entry', async () => {
    const path = join(directory, 'broken.png');
    await writeFile(
      path,
      Buffer.concat([shot.subarray(0, 8), Buffer.from('x')]),
    );

    expect(await runTool(nativeReadTool, { path }, context(), 5)).toEqual({
      status: 'error',
      type: 'unsupported_media_type',
      message: MEDIA_REFUSAL.unsupportedImage.message,
    });
    expect(held()).toBeUndefined();
  });

  it('decodes nothing for a read the policy denies', async () => {
    const path = join(directory, 'shot.png');
    await writeFile(path, shot);
    const result = await runTool(
      nativeReadTool,
      { path },
      context({
        permissionPolicy: compileToolPermissionMap(
          { read: { allow: [{ field: 'path', regex: '^kb://' }] } },
          'p',
        ),
      }),
      5,
    );

    expect(result).toMatchObject({
      status: 'error',
      type: 'permission_denied',
    });
    expect(JSON.stringify(result)).not.toContain('thumbnail');
    expect(held()).toBeUndefined();
  });

  it.each(['host', 'file'])(
    'reads a PDF original through a %s locator',
    async (scheme) => {
      const bytes = await pdfFixture('fifteen-pages.pdf');
      const path = join(directory, 'paper.dat');
      await writeFile(path, bytes);
      const locator = scheme === 'file' ? `file://${path}` : path;
      const result = await runTool(
        nativeReadTool,
        { path: locator },
        context(),
        5,
      );

      expect(result).toEqual({
        status: 'success',
        kind: 'pdf',
        mediaType: 'application/pdf',
        pages: 15,
        byteSize: bytes.byteLength,
        path,
      });
      expect(memory.get('call')).toEqual({
        locator,
        pages: 15,
        data: bytes.toString('base64'),
      });
    },
  );

  it('refuses an encrypted PDF without falling back to text or retaining bytes', async () => {
    const path = join(directory, 'private.pdf');
    await writeFile(path, await pdfFixture('owner-password.pdf'));

    await expect(
      runTool(nativeReadTool, { path }, context(), 5),
    ).resolves.toMatchObject({
      status: 'error',
      type: 'unsupported_media_type',
    });
    expect(memory.has('call')).toBe(false);
  });

  describe('Knowledge and skill media', () => {
    function knowledgeContext(): ToolContext {
      return context({
        nativeExecutorId: undefined,
        knowledgeResolver: {
          listForOwnerPage: () => Promise.resolve({ spaces: [] }),
          resolveBindingForOwnerById: (_owner, id) =>
            Promise.resolve(
              id === SPACE
                ? {
                    id: SPACE,
                    name: 'Personal',
                    root: directory,
                    directory: join(directory, SPACE),
                  }
                : undefined,
            ),
          createAdapter: (binding) => new KnowledgeFilesystemAdapter(binding),
        },
      });
    }

    beforeEach(async () => {
      await mkdir(join(directory, SPACE, 'diagrams'), { recursive: true });
      await writeFile(join(directory, SPACE, 'diagrams', 'flow.png'), shot);
    });

    it('keeps the Knowledge attribution and notice, exposes no host path or media locator, and leaves the file unchanged', async () => {
      const locator = `kb://${SPACE}/diagrams/flow.png`;
      const result = await runTool(
        nativeReadTool,
        { path: locator },
        knowledgeContext(),
        5,
      );

      expect(shown(result)).toEqual({
        ...IMAGE,
        path: locator,
        knowledgeSpaceId: SPACE,
        knowledgeSpaceName: 'Personal',
        notice: KNOWLEDGE_CONTENT_NOTICE,
      });
      expect(JSON.stringify(result)).not.toContain(directory);
      expect(JSON.stringify(result)).not.toContain('media://');
      expect(held()?.locator).toBe(locator);
      expect(media.lookups).toEqual([]);
      expect(
        await readFile(join(directory, SPACE, 'diagrams', 'flow.png')),
      ).toEqual(shot);
    });

    it('reads a Knowledge PDF with public attribution and no host path or durable bytes', async () => {
      const bytes = await pdfFixture('fifteen-pages.pdf');
      const path = join(directory, SPACE, 'diagrams', 'paper.pdf');
      await writeFile(path, bytes);
      const locator = `kb://${SPACE}/diagrams/paper.pdf`;
      const result = await runTool(
        nativeReadTool,
        { path: locator },
        knowledgeContext(),
        5,
      );

      expect(result).toEqual({
        status: 'success',
        kind: 'pdf',
        mediaType: 'application/pdf',
        pages: 15,
        byteSize: bytes.byteLength,
        path: locator,
        knowledgeSpaceId: SPACE,
        knowledgeSpaceName: 'Personal',
        notice: KNOWLEDGE_CONTENT_NOTICE,
      });
      expect(memory.get('call')).toEqual({
        locator,
        pages: 15,
        data: bytes.toString('base64'),
      });
    });

    it("decodes nothing for another owner's Space", async () => {
      expect(
        await runTool(
          nativeReadTool,
          { path: `kb://${OTHER_SPACE}/diagrams/flow.png` },
          knowledgeContext(),
          5,
        ),
      ).toMatchObject({ status: 'error', type: 'knowledge_space_not_found' });
      expect(held()).toBeUndefined();
    });

    it('keeps the skill envelope', async () => {
      const source = join(directory, 'skills');
      await mkdir(join(source, 'pdf', 'assets'), { recursive: true });
      await writeFile(
        join(source, 'pdf', 'SKILL.md'),
        '---\nname: pdf\ndescription: The pdf skill.\n---\n# pdf\n',
      );
      await writeFile(join(source, 'pdf', 'assets', 'sample.png'), shot);

      const result = await runTool(
        nativeReadTool,
        { path: 'skill://pdf/assets/sample.png' },
        context({
          nativeExecutorId: undefined,
          skillCatalog: new SkillCatalog([source]),
        }),
        5,
      );

      expect(result).toMatchObject({
        ...IMAGE,
        path: 'skill://pdf/assets/sample.png',
        locator: 'skill://pdf/assets/sample.png',
        sourceDirectory: source,
        resolvedPath: join(source, 'pdf', 'assets', 'sample.png'),
        skillDirectory: join(source, 'pdf'),
      });
      expect(result).not.toHaveProperty('content');
      expect(result).not.toHaveProperty('media');
      expect(held()?.locator).toBe('skill://pdf/assets/sample.png');
    });

    it('reads a skill PDF with its package attribution', async () => {
      const bytes = await pdfFixture('fifteen-pages.pdf');
      const source = join(directory, 'skills');
      const skillDirectory = join(source, 'documents');
      await mkdir(skillDirectory, { recursive: true });
      await writeFile(
        join(skillDirectory, 'SKILL.md'),
        '---\nname: documents\ndescription: Read documents\n---\n# Documents\n',
      );
      await writeFile(join(skillDirectory, 'paper.pdf'), bytes);
      const locator = 'skill://documents/paper.pdf';
      const result = await runTool(
        nativeReadTool,
        { path: locator },
        context({
          nativeExecutorId: undefined,
          skillCatalog: new SkillCatalog([source]),
        }),
        5,
      );

      expect(result).toMatchObject({
        status: 'success',
        kind: 'pdf',
        mediaType: 'application/pdf',
        pages: 15,
        byteSize: bytes.byteLength,
        path: locator,
        locator,
        sourceDirectory: source,
        resolvedPath: join(skillDirectory, 'paper.pdf'),
        skillDirectory,
      });
      expect(memory.get('call')).toEqual({
        locator,
        pages: 15,
        data: bytes.toString('base64'),
      });
    });
  });

  describe('media locators', () => {
    /** A process with no executor and no Knowledge, inside a Workspace. */
    const mediaContext = (overrides: Partial<ToolContext> = {}) =>
      context({
        nativeExecutorId: undefined,
        runId: undefined,
        workspaceRoot: createWorkspaceRootCell(directory),
        ...overrides,
      });

    it("returns the owner's stored image without an executor, a thumbnail, or a memory entry", async () => {
      expect(
        await runTool(
          nativeReadTool,
          { path: `media://${OWNED}` },
          mediaContext(),
          5,
        ),
      ).toEqual({ ...STORED_IMAGE, path: `media://${OWNED}` });
      expect(held()).toBeUndefined();
    });

    it.each([
      'media://',
      'media://123',
      `media://${OWNED.toUpperCase()}`,
      `MEDIA://${OWNED}`,
      `media://${OWNED}/x`,
    ])('refuses %s as invalid_path before any lookup', async (path) => {
      expect(
        await runTool(nativeReadTool, { path }, mediaContext(), 5),
      ).toEqual({
        status: 'error',
        type: 'invalid_path',
        message: 'A media locator is media:// followed by a lower-case UUID.',
      });
      expect(media.lookups).toEqual([]);
    });

    it.each([
      ['an unknown id', '0190f5e2-7c1a-7b3e-9d4f-000000000000'],
      ["another owner's id", OWNED],
    ])('answers %s with not_found', async (_, id) => {
      expect(
        await runTool(
          nativeReadTool,
          { path: `media://${id}` },
          mediaContext({
            media: createToolMediaStore(media.service, 'other', memory),
          }),
          5,
        ),
      ).toMatchObject({
        status: 'error',
        type: 'not_found',
      });
    });

    it.each([':raw', ':1-5', ':outline', ':-20'])(
      'refuses the %s selector before any lookup',
      async (selector) => {
        expect(
          await runTool(
            nativeReadTool,
            { path: `media://${OWNED}${selector}` },
            mediaContext(),
            5,
          ),
        ).toEqual({
          status: 'error',
          type: 'invalid_selector',
          message: MEDIA_SELECTOR_MESSAGE,
        });
        expect(media.lookups).toEqual([]);
      },
    );

    it('refuses edit and write without a lookup', async () => {
      const edit = await runTool(
        nativeEditTool,
        { path: `media://${OWNED}`, oldText: 'a', newText: 'b' },
        mediaContext(),
        5,
      );
      const write = await runTool(
        nativeWriteTool,
        { path: `media://${OWNED}`, content: 'x' },
        mediaContext(),
        5,
      );

      expect(edit).toEqual({
        status: 'error',
        type: 'unsupported_operation',
        message:
          'Media locators are read-only; edit and write cannot target them.',
      });
      expect(write).toEqual(edit);
      expect(media.lookups).toEqual([]);
    });

    it('rejects a media read under a policy without a media allow, before any lookup', async () => {
      const result = await runTool(
        nativeReadTool,
        { path: `media://${OWNED}` },
        mediaContext({
          permissionPolicy: compileToolPermissionMap(
            {
              read: {
                allow: [
                  {
                    field: 'path',
                    regex: String.raw`^https://docs\.example\.com/`,
                  },
                ],
              },
            },
            'p',
          ),
        }),
        5,
      );

      expect(result).toMatchObject({
        status: 'error',
        type: 'permission_denied',
      });
      expect(media.lookups).toEqual([]);
    });

    it('fails closed without a media store', async () => {
      expect(
        await runTool(
          nativeReadTool,
          { path: `media://${OWNED}` },
          mediaContext({ media: undefined }),
          5,
        ),
      ).toMatchObject({ status: 'error', type: 'invalid_path' });
    });

    it('fails another scheme closed with a media store', async () => {
      expect(
        await runTool(
          nativeReadTool,
          { path: `vault://${OWNED}` },
          mediaContext(),
          5,
        ),
      ).toEqual({
        status: 'error',
        type: 'invalid_path',
        message: 'This path scheme is not available.',
      });
      expect(media.lookups).toEqual([]);
    });
  });

  describe('tool media store', () => {
    it('decodes an image of exactly the byte bound', async () => {
      const store = createToolMediaStore(media.service, 'owner', memory);

      expect(
        shown(
          await store.readMedia(
            'shot.png',
            'call',
          )({
            kind: 'image',
            byteSize: MEDIA_MAX_BYTES,
            readBytes: () => Promise.resolve(shot),
          }),
        ),
      ).toEqual({
        status: 'success',
        kind: 'image',
        mediaType: 'image/png',
        width: 160,
        height: 90,
      });
      expect(held()?.locator).toBe('shot.png');
    });

    it('holds nothing for a read without a tool call id', async () => {
      const store = createToolMediaStore(media.service, 'owner', memory);

      await store.readMedia(
        'shot.png',
        undefined,
      )({
        kind: 'image',
        byteSize: shot.length,
        readBytes: () => Promise.resolve(shot),
      });

      expect(held()).toBeUndefined();
    });

    it('holds nothing for a read aborted while it decodes', async () => {
      const store = createToolMediaStore(media.service, 'owner', memory);
      const abort = new AbortController();
      const reason = new Error('read timed out');

      await expect(
        store.readMedia(
          'shot.png',
          'call',
        )({
          kind: 'image',
          byteSize: shot.length,
          readBytes: () => {
            abort.abort(reason);
            return Promise.resolve(shot);
          },
          signal: abort.signal,
        }),
      ).rejects.toBe(reason);
      expect(memory.size).toBe(0);
    });

    it('propagates a failure that is not a preparation refusal', async () => {
      const failure = new Error('disk unavailable');
      const store = createToolMediaStore(media.service, 'owner', memory);

      await expect(
        store.readMedia(
          'shot.png',
          'call',
        )({
          kind: 'image',
          byteSize: shot.length,
          readBytes: () => Promise.reject(failure),
        }),
      ).rejects.toBe(failure);
    });
  });
});
