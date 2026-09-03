/** Real-Postgres owner isolation and runtime binding coverage for Knowledge tools. */

import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import postgres from 'postgres';

import * as schema from '../db/schema';
import { TenantDbService } from '../db/tenant-db.service';
import { BUILT_IN_DEFAULTS } from '../instance-config/llame-config';
import { runTool } from '../tools/runner';
import { type ToolContext, type ToolResult } from '../tools/types';
import { KnowledgeToolCandidateResolver } from './knowledge-tool-candidate-resolver';
import { knowledgeReadTool, knowledgeSearchTool } from './knowledge-tools';
import { KnowledgeSpaceLocalResolver } from './knowledge-space.local-resolver';
import { KnowledgeSpaceService } from './knowledge-space.service';
import { KnowledgeToolRuntimeResolver } from './knowledge-tool-runtime-resolver';

const TEST_DB_URL = process.env['TEST_DATABASE_URL'];
const describeIfDb = TEST_DB_URL ? describe : describe.skip;
type SqlClient = ReturnType<typeof postgres>;
type KnowledgeTestArguments = {
  readonly query?: string;
  readonly limit?: number;
  readonly offset?: number;
  readonly path?: string;
  readonly ownerUserId?: string;
  readonly knowledgeSpaceId?: string;
  readonly root?: string;
  readonly source?: string;
};

describeIfDb('Knowledge tools — real Postgres owner binding', () => {
  let sql: SqlClient;
  let tenantDb: TenantDbService;
  let root: string;
  let spaceService: KnowledgeSpaceService;
  let runtimeResolver: KnowledgeToolRuntimeResolver;
  let ownerAId: string;
  let ownerBId: string;
  let ownerWithoutSpaceId: string;
  let spaceAId: string;
  let spaceBId: string;

  const ownerAContent = 'shared-term belongs only to owner A';
  const ownerBContent = 'shared-term belongs only to owner B';

  function childPath(spaceId: string): string {
    return path.join(root, spaceId);
  }

  function notePath(spaceId: string, relativePath: string): string {
    return path.join(childPath(spaceId), ...relativePath.split('/'));
  }

  function writeNote(
    spaceId: string,
    relativePath: string,
    content: string,
  ): void {
    const absolutePath = notePath(spaceId, relativePath);
    writeFileSync(absolutePath, content, 'utf8');
  }

  function context(
    userId: string,
    resolver: KnowledgeToolRuntimeResolver = runtimeResolver,
  ): ToolContext {
    return {
      userId,
      chatId: 'knowledge-tools-chat',
      tenantDb,
      knowledgeResolver: resolver,
    };
  }

  async function runKnowledge(
    tool: typeof knowledgeSearchTool | typeof knowledgeReadTool,
    userId: string,
    args: KnowledgeTestArguments,
    resolver: KnowledgeToolRuntimeResolver = runtimeResolver,
  ): Promise<ToolResult> {
    return runTool(tool, args, context(userId, resolver), 15);
  }

  function json(result: ToolResult): string {
    return JSON.stringify(result);
  }

  beforeAll(async () => {
    root = mkdtempSync(path.join(tmpdir(), 'llame-knowledge-tools-'));
    sql = postgres(TEST_DB_URL!, {
      max: 6,
      ssl: /sslmode=require/.test(TEST_DB_URL!) ? 'require' : false,
    });
    tenantDb = new TenantDbService(drizzle(sql, { schema }));
    spaceService = new KnowledgeSpaceService(
      tenantDb,
      new KnowledgeSpaceLocalResolver(root),
    );
    runtimeResolver = new KnowledgeToolRuntimeResolver(spaceService);

    ownerAId = crypto.randomUUID();
    ownerBId = crypto.randomUUID();
    ownerWithoutSpaceId = crypto.randomUUID();
    await sql`
      INSERT INTO users (id, name, email)
      VALUES
        (${ownerAId}, 'Knowledge Tools A', ${`knowledge-tools-a-${ownerAId}@test.com`}),
        (${ownerBId}, 'Knowledge Tools B', ${`knowledge-tools-b-${ownerBId}@test.com`}),
        (${ownerWithoutSpaceId}, 'Knowledge Tools C', ${`knowledge-tools-c-${ownerWithoutSpaceId}@test.com`})
    `;

    const spaceA = await spaceService.provisionForOwner(ownerAId);
    const spaceB = await spaceService.provisionForOwner(ownerBId);
    spaceAId = spaceA.id;
    spaceBId = spaceB.id;
    expect(spaceAId).not.toBe(spaceBId);
    expect(path.dirname(childPath(spaceAId))).toBe(root);
    expect(path.dirname(childPath(spaceBId))).toBe(root);
    expect(lstatSync(childPath(spaceAId)).isDirectory()).toBe(true);
    expect(lstatSync(childPath(spaceBId)).isDirectory()).toBe(true);

    for (const [spaceId, relativePath] of [
      [spaceAId, 'notes/owner-a.md'],
      [spaceBId, 'notes/owner-b.md'],
    ]) {
      const directory = path.dirname(notePath(spaceId, relativePath));
      mkdirSync(directory, { recursive: true });
    }
    writeNote(spaceAId, 'notes/owner-a.md', ownerAContent);
    writeNote(spaceBId, 'notes/owner-b.md', ownerBContent);
  });

  afterAll(async () => {
    try {
      if (sql) {
        await sql`
          DELETE FROM users
          WHERE id IN (${ownerAId}, ${ownerBId}, ${ownerWithoutSpaceId})
        `;
      }
    } finally {
      if (sql) await sql.end();
      if (root) rmSync(root, { recursive: true, force: true });
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('binds each owner to only its stable child and returns safe attribution', async () => {
    const ownerAPage = await runtimeResolver.listForOwnerPage(ownerAId);
    const ownerABinding = await runtimeResolver.resolveBindingForOwnerById(
      ownerAId,
      spaceAId,
    );
    expect(ownerAPage.spaces).toContainEqual(
      expect.objectContaining({ id: spaceAId, name: 'Personal' }),
    );
    expect(ownerABinding).toMatchObject({ id: spaceAId, name: 'Personal' });
    if (ownerABinding === undefined) {
      throw new Error('Expected owner A binding');
    }
    await expect(
      runtimeResolver.createAdapter(ownerABinding).search('shared-term', 5),
    ).resolves.toHaveLength(1);
    const resultA = await runKnowledge(knowledgeSearchTool, ownerAId, {
      query: 'shared-term',
      limit: 5,
    });
    const resultB = await runKnowledge(knowledgeSearchTool, ownerBId, {
      query: 'shared-term',
      limit: 5,
    });
    const readA = await runKnowledge(knowledgeReadTool, ownerAId, {
      knowledgeSpaceId: spaceAId,
      path: 'notes/owner-a.md',
    });
    const readB = await runKnowledge(knowledgeReadTool, ownerBId, {
      knowledgeSpaceId: spaceBId,
      path: 'notes/owner-b.md',
    });

    expect(resultA).toMatchObject({
      status: 'success',
      results: [
        {
          knowledgeSpaceId: spaceAId,
          knowledgeSpaceName: 'Personal',
          path: 'notes/owner-a.md',
          offset: 0,
          limit: 1,
          excerpt: ownerAContent,
        },
      ],
    });
    expect(resultB).toMatchObject({
      status: 'success',
      results: [
        {
          knowledgeSpaceId: spaceBId,
          knowledgeSpaceName: 'Personal',
          path: 'notes/owner-b.md',
          offset: 0,
          limit: 1,
          excerpt: ownerBContent,
        },
      ],
    });
    expect(readA).toMatchObject({
      status: 'success',
      knowledgeSpaceId: spaceAId,
      path: 'notes/owner-a.md',
      offset: 0,
      lineCount: 1,
      content: `1: ${ownerAContent}`,
    });
    expect(readB).toMatchObject({
      status: 'success',
      knowledgeSpaceId: spaceBId,
      path: 'notes/owner-b.md',
      offset: 0,
      lineCount: 1,
      content: `1: ${ownerBContent}`,
    });

    const ownerAJson = json(resultA);
    const ownerBJson = json(resultB);
    expect(ownerAJson).toContain('owner-a.md');
    expect(ownerAJson).not.toContain('owner-b.md');
    expect(ownerAJson).not.toContain(ownerBContent);
    expect(ownerAJson).not.toContain(ownerBId);
    expect(ownerAJson).not.toContain(spaceBId);
    expect(ownerBJson).toContain('owner-b.md');
    expect(ownerBJson).not.toContain('owner-a.md');
    expect(ownerBJson).not.toContain(ownerAContent);
    expect(ownerBJson).not.toContain(ownerAId);
    expect(ownerBJson).not.toContain(spaceAId);
    for (const output of [ownerAJson, ownerBJson, json(readA), json(readB)]) {
      expect(output).not.toContain(root);
    }
    expect(json(readA)).not.toContain(ownerBId);
    expect(json(readB)).not.toContain(ownerAId);
  });

  it('searches, renames, and revokes multiple current spaces live', async () => {
    const second = await spaceService.provisionForOwner(ownerAId, {
      name: 'Projects',
    });
    mkdirSync(path.dirname(notePath(second.id, 'projects/note.md')), {
      recursive: true,
    });
    writeNote(spaceAId, 'notes/multi.md', 'multi-space-term personal');
    writeNote(second.id, 'projects/note.md', 'multi-space-term projects');

    const allSpaces = await runKnowledge(knowledgeSearchTool, ownerAId, {
      query: 'multi-space-term',
      limit: 5,
    });
    const explicit = await runKnowledge(knowledgeSearchTool, ownerAId, {
      query: 'multi-space-term',
      limit: 5,
      knowledgeSpaceId: second.id,
    });

    expect(allSpaces).toMatchObject({
      status: 'success',
      complete: true,
      results: [
        {
          knowledgeSpaceId: spaceAId,
          knowledgeSpaceName: 'Personal',
          path: 'notes/multi.md',
        },
        {
          knowledgeSpaceId: second.id,
          knowledgeSpaceName: 'Projects',
          path: 'projects/note.md',
        },
      ],
    });
    expect(explicit).toMatchObject({
      status: 'success',
      results: [
        {
          knowledgeSpaceId: second.id,
          knowledgeSpaceName: 'Projects',
          path: 'projects/note.md',
        },
      ],
    });

    await spaceService.renameForOwner(ownerAId, second.id, {
      name: 'Renamed projects',
    });
    const renamedRead = await runKnowledge(knowledgeReadTool, ownerAId, {
      knowledgeSpaceId: second.id,
      path: 'projects/note.md',
    });
    expect(renamedRead).toMatchObject({
      status: 'success',
      knowledgeSpaceId: second.id,
      knowledgeSpaceName: 'Renamed projects',
    });
    expect(json(allSpaces)).toContain('Projects');
    expect(json(allSpaces)).not.toContain('Renamed projects');

    const revoked = await spaceService.provisionForOwner(ownerAId, {
      name: 'Revoked',
    });
    writeNote(revoked.id, 'revoked.md', 'revoked content');
    await expect(
      runKnowledge(knowledgeReadTool, ownerAId, {
        knowledgeSpaceId: revoked.id,
        path: 'revoked.md',
      }),
    ).resolves.toMatchObject({ status: 'success' });
    await tenantDb.runAs(ownerAId, (tx) =>
      tx
        .delete(schema.knowledgeSpaces)
        .where(eq(schema.knowledgeSpaces.knowledgeSpaceId, revoked.id)),
    );
    await expect(
      runKnowledge(knowledgeReadTool, ownerAId, {
        knowledgeSpaceId: revoked.id,
        path: 'revoked.md',
      }),
    ).resolves.toEqual({
      status: 'error',
      type: 'knowledge_space_not_found',
      message: 'Knowledge Space was not found.',
    });
    expect(lstatSync(childPath(revoked.id)).isDirectory()).toBe(true);

    const broken = await spaceService.provisionForOwner(ownerAId, {
      name: 'Broken',
    });
    rmSync(childPath(broken.id), { recursive: true, force: true });
    const incomplete = await runKnowledge(knowledgeSearchTool, ownerAId, {
      query: 'multi-space-term',
      limit: 5,
    });
    expect(incomplete).toMatchObject({
      status: 'success',
      complete: false,
      warningCount: 1,
      warnings: [
        {
          type: 'knowledge_space_unavailable',
          knowledgeSpaceId: broken.id,
          knowledgeSpaceName: 'Broken',
        },
      ],
    });
  });

  it('observes live writes through the current numbered read range', async () => {
    const relativePath = 'notes/live.md';
    const before = 'shared-term before the edit';
    const after = 'shared-term after the edit';
    writeNote(spaceAId, relativePath, before);

    const first = await runKnowledge(knowledgeReadTool, ownerAId, {
      knowledgeSpaceId: spaceAId,
      path: relativePath,
      offset: 0,
      limit: 1,
    });
    writeNote(spaceAId, relativePath, after);
    const second = await runKnowledge(knowledgeReadTool, ownerAId, {
      knowledgeSpaceId: spaceAId,
      path: relativePath,
      offset: 0,
      limit: 1,
    });

    expect(first).toMatchObject({
      status: 'success',
      offset: 0,
      lineCount: 1,
      content: `1: ${before}`,
    });
    expect(second).toMatchObject({
      status: 'success',
      offset: 0,
      lineCount: 1,
      content: `1: ${after}`,
    });
    expect(first).not.toEqual(second);
  });

  it('accepts independently of the API mount and fails closed on a separately mounted worker', async () => {
    const apiCandidateResolver = new KnowledgeToolCandidateResolver({
      config: {
        ...BUILT_IN_DEFAULTS,
        knowledge: { root },
      },
    });
    const candidates = await tenantDb.runAs(ownerAId, (tx) =>
      apiCandidateResolver.resolve({
        tx,
        ownerUserId: ownerAId,
        allowedToolRules: ['knowledge_search', 'knowledge_read'],
      }),
    );

    expect(
      candidates
        .filter(
          (candidate) =>
            candidate.state === 'available' &&
            candidate.tool.id.startsWith('knowledge_'),
        )
        .map((candidate) =>
          candidate.state === 'available' ? candidate.tool.id : undefined,
        ),
    ).toEqual(['knowledge_search', 'knowledge_read']);

    const workerRoot = path.join(root, 'separate-worker-mount-is-missing');
    const workerResolver = new KnowledgeToolRuntimeResolver(
      new KnowledgeSpaceService(
        tenantDb,
        new KnowledgeSpaceLocalResolver(workerRoot),
      ),
    );
    const result = await runKnowledge(
      knowledgeReadTool,
      ownerAId,
      { knowledgeSpaceId: spaceAId, path: 'notes/owner-a.md' },
      workerResolver,
    );

    expect(result).toEqual({
      status: 'error',
      type: 'knowledge_space_unavailable',
      message: 'The Knowledge Space is unavailable.',
    });
    expect(() => lstatSync(workerRoot)).toThrow(/ENOENT/);
    expect(json(result)).not.toContain(root);
  });

  it('rejects caller-selected identity and location arguments before filesystem access', async () => {
    const resolveBindingForOwnerById = vi.spyOn(
      runtimeResolver,
      'resolveBindingForOwnerById',
    );
    const invalidCalls: Array<
      [
        typeof knowledgeSearchTool | typeof knowledgeReadTool,
        KnowledgeTestArguments,
      ]
    > = [
      [knowledgeSearchTool, { query: 'shared-term', ownerUserId: ownerBId }],
      [knowledgeSearchTool, { query: 'shared-term', root }],
      [knowledgeReadTool, { path: 'notes/owner-a.md', ownerUserId: ownerBId }],
      [knowledgeReadTool, { path: 'notes/owner-a.md', root }],
      [knowledgeReadTool, { path: 'notes/owner-a.md', source: 'other' }],
    ];

    for (const [tool, args] of invalidCalls) {
      const result = await runKnowledge(tool, ownerAId, args);
      expect(result).toMatchObject({ status: 'error', type: 'invalid_input' });
      expect(json(result)).not.toContain(root);
      expect(json(result)).not.toContain(spaceBId);
      expect(json(result)).not.toContain(ownerBId);
    }
    expect(resolveBindingForOwnerById).not.toHaveBeenCalled();

    for (const [tool, args] of [
      [
        knowledgeSearchTool,
        { query: 'shared-term', knowledgeSpaceId: spaceBId },
      ],
      [
        knowledgeReadTool,
        { path: 'notes/owner-a.md', knowledgeSpaceId: spaceBId },
      ],
    ] as const) {
      const result = await runKnowledge(tool, ownerAId, args);
      expect(result).toEqual({
        status: 'error',
        type: 'knowledge_space_not_found',
        message: 'Knowledge Space was not found.',
      });
      expect(json(result)).not.toContain(spaceBId);
      expect(json(result)).not.toContain(ownerBId);
      expect(json(result)).not.toContain(root);
    }
  });

  it('keeps a path-shaped other-owner identifier inside the current child', async () => {
    const guessedPath = `${spaceBId}/notes/owner-b.md`;
    const result = await runKnowledge(knowledgeReadTool, ownerAId, {
      knowledgeSpaceId: spaceAId,
      path: guessedPath,
    });

    expect(result).toEqual({
      status: 'error',
      type: 'knowledge_not_found',
      message: 'The Knowledge note was not found.',
    });
    expect(lstatSync(childPath(spaceAId)).isDirectory()).toBe(true);
    expect(() => lstatSync(path.join(childPath(spaceAId), spaceBId))).toThrow(
      /ENOENT/,
    );
    expect(json(result)).not.toContain(guessedPath);
    expect(json(result)).not.toContain(ownerBId);
    expect(json(result)).not.toContain(spaceBId);
    expect(json(result)).not.toContain(ownerBContent);
    expect(json(result)).not.toContain(root);
  });

  it('closes missing rows, missing roots, and missing children without recreation', async () => {
    const noRow = await runKnowledge(knowledgeSearchTool, ownerWithoutSpaceId, {
      query: 'shared-term',
      limit: 5,
    });
    expect(noRow).toEqual({
      status: 'error',
      type: 'knowledge_space_not_configured',
      message: 'Knowledge Space is not configured.',
    });

    const unavailableRootService = new KnowledgeSpaceService(
      tenantDb,
      new KnowledgeSpaceLocalResolver(undefined),
    );
    const unavailableRootResolver = new KnowledgeToolRuntimeResolver(
      unavailableRootService,
    );
    const noRoot = await runKnowledge(
      knowledgeReadTool,
      ownerAId,
      { knowledgeSpaceId: spaceAId, path: 'notes/owner-a.md' },
      unavailableRootResolver,
    );
    expect(noRoot).toEqual({
      status: 'error',
      type: 'knowledge_space_unavailable',
      message: 'The Knowledge Space is unavailable.',
    });

    const child = childPath(spaceBId);
    rmSync(child, { recursive: true, force: true });
    try {
      const noChild = await runKnowledge(knowledgeReadTool, ownerBId, {
        knowledgeSpaceId: spaceBId,
        path: 'notes/owner-b.md',
      });
      expect(noChild).toEqual({
        status: 'error',
        type: 'knowledge_space_unavailable',
        message: 'The Knowledge Space is unavailable.',
      });
      expect(() => lstatSync(child)).toThrow(/ENOENT/);
    } finally {
      await spaceService.provisionForOwner(ownerBId);
      const notes = path.join(child, 'notes');
      mkdirSync(notes, { recursive: true });
      writeNote(spaceBId, 'notes/owner-b.md', ownerBContent);
    }

    for (const output of [json(noRow), json(noRoot)]) {
      expect(output).not.toContain(root);
      expect(output).not.toContain(spaceAId);
      expect(output).not.toContain(spaceBId);
    }
  });

  it('fails closed before resolver access for absent or anonymous trusted context', async () => {
    const resolveBindingForOwner = vi.spyOn(
      runtimeResolver,
      'resolveBindingForOwner',
    );
    const absent = await runTool(
      knowledgeReadTool,
      { knowledgeSpaceId: spaceAId, path: 'notes/owner-a.md' },
      undefined,
      15,
    );
    expect(absent).toEqual({
      status: 'error',
      type: 'no_context',
      message: 'Tool execution requires a resolvable run owner.',
    });

    const anonymous = await runTool(
      knowledgeReadTool,
      { knowledgeSpaceId: spaceAId, path: 'notes/owner-a.md' },
      context(''),
      15,
    );
    expect(anonymous).toEqual({
      status: 'error',
      type: 'no_context',
      message: 'Tool execution requires a resolvable run owner.',
    });
    expect(resolveBindingForOwner).not.toHaveBeenCalled();
  });
});
