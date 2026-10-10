import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { drizzle } from 'drizzle-orm/postgres-js';
import { IMAGE_SELECTOR_MESSAGE } from '@workspace/native-file-tools';

import * as schema from '../db/schema';
import type { MediaObject } from '../db/schema';
import type { Db } from '../db/tenant-db.service';
import { KNOWLEDGE_CONTENT_NOTICE } from '../knowledge/knowledge-content-notice';
import { KnowledgeFilesystemAdapter } from '../knowledge/knowledge-filesystem';
import { MEDIA_MAX_BYTES, MediaIngestError } from '../media/media-ingest';
import type { MediaIngestInput, MediaService } from '../media/media.service';
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

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('png body'),
]);

function mediaObject(id: string, ownerUserId: string): MediaObject {
  return {
    id,
    ownerUserId,
    provenance: 'read',
    name: 'shot.png',
    mediaType: 'image/png',
    width: 1600,
    height: 900,
    byteSize: PNG.length,
    modelMediaType: 'image/png',
    modelWidth: 1600,
    modelHeight: 900,
    modelByteSize: PNG.length,
    sha256: 'digest',
    createdAt: new Date(0),
  };
}

type FakeMedia = {
  service: Pick<MediaService, 'ingest' | 'findOwned'>;
  ingested: Array<{ owner: string; input: MediaIngestInput }>;
  lookups: Array<string>;
};

/**
 * The owner's media through a MediaService double: `owner` holds OWNED, and
 * every ingest stores OWNED for its caller.
 */
function fakeMedia(): FakeMedia {
  const ingested: Array<{ owner: string; input: MediaIngestInput }> = [];
  const lookups: Array<string> = [];
  const objects = [mediaObject(OWNED, 'owner')];
  const service: Pick<MediaService, 'ingest' | 'findOwned'> = {
    ingest: (owner, input) => {
      ingested.push({ owner, input });
      return Promise.resolve({
        media: mediaObject(OWNED, owner),
        created: true,
      });
    },
    findOwned: (owner, id) => {
      lookups.push(id);
      return Promise.resolve(
        objects.find((entry) => entry.id === id && entry.ownerUserId === owner),
      );
    },
  };
  return { service, ingested, lookups };
}

const IMAGE = {
  status: 'success',
  kind: 'image',
  media: `media://${OWNED}`,
  mediaType: 'image/png',
  width: 1600,
  height: 900,
};

describe('native image reads', () => {
  let directory: string;
  let media: FakeMedia;

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
      media: createToolMediaStore(media.service, 'owner', 'read'),
      ...overrides,
    };
  }

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'native-image-'));
    media = fakeMedia();
    // A host read records its attempt before reading; no prior one exists.
    vi.spyOn(NativeFilesRepository.prototype, 'begin').mockResolvedValue(
      undefined,
    );
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(directory, { recursive: true, force: true });
  });

  it('ingests a host image with read provenance and the read path as its source', async () => {
    const path = join(directory, 'shot.png');
    await writeFile(path, PNG);

    expect(await runTool(nativeReadTool, { path }, context(), 5)).toEqual({
      ...IMAGE,
      path,
    });
    expect(media.ingested).toEqual([
      {
        owner: 'owner',
        input: { bytes: PNG, provenance: 'read', source: path },
      },
    ]);
  });

  it('labels a Workspace-relative image with the submitted path and reports its projected path', async () => {
    await writeFile(join(directory, 'shot.png'), PNG);
    const result = await runTool(
      nativeReadTool,
      { path: 'shot.png' },
      context({ workspaceRoot: createWorkspaceRootCell(directory) }),
      5,
    );

    expect(result).toEqual({ ...IMAGE, path: join(directory, 'shot.png') });
    expect(media.ingested[0]?.input.source).toBe('shot.png');
  });

  it('labels a file: alias image with the submitted URL and reports its host path', async () => {
    const path = join(directory, 'shot.png');
    await writeFile(path, PNG);
    const submitted = `file://${path}`;

    expect(
      await runTool(nativeReadTool, { path: submitted }, context(), 5),
    ).toEqual({ ...IMAGE, path });
    expect(media.ingested[0]?.input.source).toBe(submitted);
  });

  it('refuses an image over 20 MiB without reading it into the store', async () => {
    const path = join(directory, 'huge.png');
    await writeFile(path, Buffer.concat([PNG, Buffer.alloc(21 * 2 ** 20)]));

    expect(await runTool(nativeReadTool, { path }, context(), 5)).toEqual({
      status: 'error',
      type: 'image_too_large',
      message: 'Image exceeds 20 MiB or 40 megapixels',
    });
    expect(media.ingested).toEqual([]);
  });

  it.each(['image_too_large', 'unsupported_media_type'] as const)(
    'fails the read with the store refusal %s and no text',
    async (code) => {
      const path = join(directory, 'shot.png');
      await writeFile(path, PNG);
      const refusing: Pick<MediaService, 'ingest' | 'findOwned'> = {
        ...media.service,
        ingest: () => Promise.reject(new MediaIngestError(code)),
      };

      expect(
        await runTool(
          nativeReadTool,
          { path },
          context({
            media: createToolMediaStore(refusing, 'owner', 'read'),
          }),
          5,
        ),
      ).toEqual({
        status: 'error',
        type: code,
        message: new MediaIngestError(code).message,
      });
    },
  );

  it('ingests nothing for a read the policy denies', async () => {
    const path = join(directory, 'shot.png');
    await writeFile(path, PNG);
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
    expect(media.ingested).toEqual([]);
  });

  describe('Knowledge and skill images', () => {
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
      await writeFile(join(directory, SPACE, 'diagrams', 'flow.png'), PNG);
    });

    it('keeps the Knowledge attribution and notice and exposes no host path', async () => {
      const locator = `kb://${SPACE}/diagrams/flow.png`;
      const result = await runTool(
        nativeReadTool,
        { path: locator },
        knowledgeContext(),
        5,
      );

      expect(result).toEqual({
        ...IMAGE,
        path: locator,
        knowledgeSpaceId: SPACE,
        knowledgeSpaceName: 'Personal',
        notice: KNOWLEDGE_CONTENT_NOTICE,
      });
      expect(JSON.stringify(result)).not.toContain(directory);
      expect(media.ingested[0]?.input.source).toBe(locator);
    });

    it("ingests nothing for another owner's Space", async () => {
      expect(
        await runTool(
          nativeReadTool,
          { path: `kb://${OTHER_SPACE}/diagrams/flow.png` },
          knowledgeContext(),
          5,
        ),
      ).toMatchObject({ status: 'error', type: 'knowledge_space_not_found' });
      expect(media.ingested).toEqual([]);
    });

    it('keeps the skill envelope', async () => {
      const source = join(directory, 'skills');
      await mkdir(join(source, 'pdf', 'assets'), { recursive: true });
      await writeFile(
        join(source, 'pdf', 'SKILL.md'),
        '---\nname: pdf\ndescription: The pdf skill.\n---\n# pdf\n',
      );
      await writeFile(join(source, 'pdf', 'assets', 'sample.png'), PNG);

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
      expect(media.ingested[0]?.input.source).toBe(
        'skill://pdf/assets/sample.png',
      );
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

    it("returns the owner's stored image without an executor or any ingest", async () => {
      expect(
        await runTool(
          nativeReadTool,
          { path: `media://${OWNED}` },
          mediaContext(),
          5,
        ),
      ).toEqual({ ...IMAGE, path: `media://${OWNED}` });
      expect(media.ingested).toEqual([]);
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
            media: createToolMediaStore(media.service, 'other', 'read'),
          }),
          5,
        ),
      ).toEqual({
        status: 'error',
        type: 'not_found',
        message: 'Image not found.',
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
          message: IMAGE_SELECTOR_MESSAGE,
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
      expect(media.ingested).toEqual([]);
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
    const read = (byteSize: number) => ({
      byteSize,
      readBytes: () => Promise.resolve(PNG),
    });

    it('ingests an image of exactly the byte bound', async () => {
      const store = createToolMediaStore(media.service, 'owner', 'read');

      expect(
        await store.ingestImage('shot.png')(read(MEDIA_MAX_BYTES)),
      ).toEqual({
        status: 'success',
        media: `media://${OWNED}`,
        mediaType: 'image/png',
        width: 1600,
        height: 900,
      });
      expect(media.ingested).toHaveLength(1);
    });

    it('propagates a failure that is not an ingest refusal', async () => {
      const failure = new Error('store unavailable');
      const store = createToolMediaStore(
        { ...media.service, ingest: () => Promise.reject(failure) },
        'owner',
        'read',
      );

      await expect(
        store.ingestImage('shot.png')(read(PNG.length)),
      ).rejects.toBe(failure);
    });
  });
});
