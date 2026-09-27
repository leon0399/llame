import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { z } from 'zod';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';

import * as schema from '../db/schema';
import { TenantDbService, type Db } from '../db/tenant-db.service';
import { ChatsRepository, MessagesRepository } from '../chats/chats-repository';
import { RunsRepository, RunEventsRepository } from '../runs/runs-repository';
import { WorkspaceBindingRepository } from '../chats/workspace-binding.repository';
import { createWorkspaceRootCell } from '../tools/workspace-path';
import { enterWorkspaceTool, exitWorkspaceTool } from '../tools/workspace';
import {
  AttemptToolAdditions,
  type AttemptToolBinding,
} from '../tools/attempt-tool-additions';
import { compileTestPermissionPolicy } from '../testing/tool-permission-policy';
import { composeTurnToolCatalog } from '../tools/turn-tool-catalog';
import { McpRuntimeService } from './mcp-runtime.service';
import { WorkspaceMcpClients } from './workspace-mcp-clients';
import {
  createMcpTestFixture,
  mcpStreamableHttpInitialize,
  type McpFixtureResponse,
  type McpTestFixture,
} from './mcp-test-fixture';

const searchDeclaration = {
  name: 'search',
  description: 'Workspace integration search.',
  inputSchema: { type: 'object', properties: {} },
};

type WorkspaceServerEntry = {
  type?: string;
  url?: string;
  headers?: Record<string, string>;
  command?: string;
  args?: Array<string>;
  env?: Record<string, string>;
};

type FixtureRpcResult = {
  tools?: Array<typeof searchDeclaration>;
  content?: Array<{ type: string; text: string }>;
  structuredContent?: { label: string; authorization?: string };
};

function rpcResult(id: number, result: FixtureRpcResult): McpFixtureResponse {
  return { kind: 'json', body: { jsonrpc: '2.0', id, result } };
}

async function writeConfig(
  root: string,
  servers: Record<string, WorkspaceServerEntry>,
): Promise<void> {
  await writeFile(
    join(root, '.mcp.json'),
    JSON.stringify({ mcpServers: servers }),
    'utf8',
  );
}

async function httpFixture(
  label: string,
  authorization?: string,
  connectionCount = 1,
): Promise<McpTestFixture> {
  const result = {
    content: [{ type: 'text', text: `workspace-${label}` }],
    structuredContent: { label, authorization },
  };
  return createMcpTestFixture({
    $get: Array.from({ length: connectionCount }, () => ({
      kind: 'raw' as const,
      status: 405,
      body: '',
    })),
    initialize: Array.from({ length: connectionCount }, () =>
      mcpStreamableHttpInitialize(),
    ),
    'notifications/initialized': Array.from(
      { length: connectionCount },
      () => ({ kind: 'raw' as const, status: 204, body: '' }),
    ),
    'tools/list': Array.from({ length: connectionCount }, () =>
      rpcResult(1, { tools: [searchDeclaration] }),
    ),
    'tools/call': [rpcResult(2, result)],
    $delete: Array.from({ length: connectionCount }, () => ({
      kind: 'raw' as const,
      status: 204,
      body: '',
    })),
  });
}

describe('Workspace MCP production integration', () => {
  let sql: ReturnType<typeof postgres>;
  let db: Db;
  let tenantDb: TenantDbService;
  let userId: string;

  beforeAll(async () => {
    const url = process.env['TEST_DATABASE_URL'];
    if (!url)
      throw new Error(
        'Integration global setup did not provide TEST_DATABASE_URL.',
      );
    sql = postgres(url, { max: 2 });
    db = drizzle(sql, { schema });
    tenantDb = new TenantDbService(db);
    userId = crypto.randomUUID();
    await sql`INSERT INTO users (id, name, email) VALUES (${userId}, 'Workspace MCP Integration', ${`workspace-mcp-${userId}@test.com`})`;
  });

  afterAll(async () => {
    await sql`DELETE FROM users WHERE id = ${userId}`;
    await sql.end();
  });

  it('isolates same-id HTTP servers for Chats and owners in one process', async () => {
    const firstFixture = await httpFixture('first');
    const secondFixture = await httpFixture('second');
    const firstRoot = await mkdtemp(join(tmpdir(), 'workspace-mcp-first-'));
    const secondRoot = await mkdtemp(join(tmpdir(), 'workspace-mcp-second-'));
    const operator = new McpRuntimeService({});
    const clients = new WorkspaceMcpClients(operator);
    const firstChat = crypto.randomUUID();
    const secondChat = crypto.randomUUID();
    const secondOwnerId = crypto.randomUUID();
    await sql`INSERT INTO users (id, name, email) VALUES (${secondOwnerId}, 'Workspace MCP Second Owner', ${`workspace-mcp-b-${secondOwnerId}@test.com`})`;
    try {
      await writeConfig(firstRoot, {
        web: { type: 'streamable-http', url: firstFixture.url },
      });
      await writeConfig(secondRoot, {
        web: { type: 'streamable-http', url: secondFixture.url },
      });
      // The other owner's Chat is a different Chat and holds nothing until it
      // starts its own clients: the first owner's client set is never inherited.
      expect(
        clients.snapshotCandidates({
          chatId: secondChat,
          root: secondRoot,
          generation: 1,
        }),
      ).toEqual([]);
      await clients.startForChat({
        chatId: firstChat,
        root: firstRoot,
        generation: 1,
      });
      await clients.startForChat({
        chatId: secondChat,
        root: secondRoot,
        generation: 1,
      });
      const first = clients
        .resolverFor(
          { chatId: firstChat, root: firstRoot, generation: 1 },
          undefined,
        )
        .resolveDynamicTool('mcp__web__search');
      const second = clients
        .resolverFor(
          { chatId: secondChat, root: secondRoot, generation: 1 },
          undefined,
        )
        .resolveDynamicTool('mcp__web__search');
      if (first.state !== 'available' || second.state !== 'available') {
        throw new Error('Workspace HTTP tools did not become available.');
      }
      const firstResult = await first.executor.execute(
        { userId, chatId: firstChat, tenantDb },
        {},
      );
      const secondResult = await second.executor.execute(
        { userId: secondOwnerId, chatId: secondChat, tenantDb },
        {},
      );
      expect(JSON.stringify(firstResult)).toContain('workspace-first');
      expect(JSON.stringify(firstResult)).not.toContain('workspace-second');
      expect(JSON.stringify(secondResult)).toContain('workspace-second');
      expect(JSON.stringify(secondResult)).not.toContain('workspace-first');
      await tenantDb.runAs(userId, async (tx) => {
        await new ChatsRepository(tx).createIfAbsent({
          id: firstChat,
          ownerUserId: userId,
          title: 'Workspace first',
        });
      });
      await tenantDb.runAs(secondOwnerId, async (tx) => {
        await new ChatsRepository(tx).createIfAbsent({
          id: secondChat,
          ownerUserId: secondOwnerId,
          title: 'Workspace second',
        });
      });
    } finally {
      await clients.onModuleDestroy();
      await operator.stop();
      await firstFixture.close();
      await secondFixture.close();
      await rm(firstRoot, { recursive: true, force: true });
      await rm(secondRoot, { recursive: true, force: true });
      await sql`DELETE FROM chats WHERE id IN (${firstChat}, ${secondChat})`;
      await sql`DELETE FROM users WHERE id = ${secondOwnerId}`;
    }
  });

  it('discards stale keys in a second process and reports malformed transports', async () => {
    const fixture = await httpFixture('current', undefined, 4);
    const oldRoot = await mkdtemp(join(tmpdir(), 'workspace-mcp-old-'));
    const currentRoot = await mkdtemp(join(tmpdir(), 'workspace-mcp-current-'));
    const malformedRoot = await mkdtemp(
      join(tmpdir(), 'workspace-mcp-malformed-'),
    );
    const operator = new McpRuntimeService({});
    const firstProcess = new WorkspaceMcpClients(operator);
    const secondProcess = new WorkspaceMcpClients(operator);
    const chatId = crypto.randomUUID();
    try {
      await writeConfig(oldRoot, {
        web: { type: 'streamable-http', url: fixture.url },
      });
      await writeConfig(currentRoot, {
        web: { type: 'streamable-http', url: fixture.url },
      });
      await writeFile(join(malformedRoot, '.mcp.json'), '{ malformed', 'utf8');
      await firstProcess.startForChat({ chatId, root: oldRoot, generation: 1 });
      await secondProcess.startForChat({
        chatId,
        root: oldRoot,
        generation: 1,
      });
      const current = { chatId, root: currentRoot, generation: 2 } as const;
      const state = await secondProcess.startForChat(current);
      expect(
        secondProcess.stateForKey({ chatId, root: oldRoot, generation: 1 }),
      ).toBeUndefined();
      expect(state.servers).toEqual([{ id: 'web', state: 'available' }]);
      const malformed = await firstProcess.startForChat({
        chatId: crypto.randomUUID(),
        root: malformedRoot,
        generation: 1,
      });
      expect(malformed.servers).toEqual([
        expect.objectContaining({ id: '.mcp.json', state: 'unavailable' }),
      ]);
      await writeConfig(malformedRoot, {
        unsupported: { type: 'sse', url: fixture.url },
      });
      const unsupported = await firstProcess.startForChat({
        chatId: crypto.randomUUID(),
        root: malformedRoot,
        generation: 2,
      });
      expect(unsupported.servers).toEqual([
        {
          id: 'unsupported',
          state: 'unavailable',
          reason: 'unsupported transport sse',
        },
      ]);
    } finally {
      await firstProcess.onModuleDestroy();
      await secondProcess.onModuleDestroy();
      await operator.stop();
      await fixture.close();
      await rm(oldRoot, { recursive: true, force: true });
      await rm(currentRoot, { recursive: true, force: true });
      await rm(malformedRoot, { recursive: true, force: true });
    }
  });

  it('redacts a literal Authorization echo from a Workspace HTTP result', async () => {
    const secret = 'workspace-literal-auth-secret';
    const fixture = await httpFixture('redaction', secret);
    const root = await mkdtemp(join(tmpdir(), 'workspace-mcp-redaction-'));
    const operator = new McpRuntimeService({});
    const clients = new WorkspaceMcpClients(operator);
    const chatId = crypto.randomUUID();
    try {
      await writeConfig(root, {
        web: {
          type: 'streamable-http',
          url: fixture.url,
          headers: { Authorization: secret },
        },
      });
      await clients.startForChat({ chatId, root, generation: 1 });
      const resolution = clients
        .resolverFor({ chatId, root, generation: 1 }, undefined)
        .resolveDynamicTool('mcp__web__search');
      if (resolution.state !== 'available')
        throw new Error('Workspace redaction tool unavailable.');
      const result = await resolution.executor.execute(
        { userId, chatId, tenantDb },
        {},
      );
      expect(JSON.stringify(result)).not.toContain(secret);
      expect(JSON.stringify(result)).toContain('[REDACTED]');
      expect(fixture.receivedHeader(3, 'authorization', secret)).toBe(true);
    } finally {
      await clients.onModuleDestroy();
      await operator.stop();
      await fixture.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  it('runs a real stdio Workspace child without inheriting an ambient variable', async () => {
    const root = await mkdtemp(join(tmpdir(), 'workspace-mcp-stdio-'));
    const dump = join(root, 'env.json');
    const fixturePath = join(
      process.cwd(),
      'src/mcp/mcp-stdio-test-fixture.mjs',
    );
    const operator = new McpRuntimeService({});
    const clients = new WorkspaceMcpClients(operator);
    const chatId = crypto.randomUUID();
    const previous = process.env['LLAME_WORKSPACE_AMBIENT_ONLY'];
    process.env['LLAME_WORKSPACE_AMBIENT_ONLY'] = 'must-not-leak';
    try {
      await writeConfig(root, {
        stdio: {
          command: process.execPath,
          args: [fixturePath],
          env: {
            MCP_FIXTURE: JSON.stringify({
              tools: [searchDeclaration],
              envDumpPath: dump,
            }),
          },
        },
      });
      await clients.startForChat({ chatId, root, generation: 1 });
      const dumpText = await readFile(dump, 'utf8');
      // SAFETY: JSON.parse returns any; asserting unknown forces the shape
      // checks below rather than silently inheriting any.
      const environment = JSON.parse(dumpText) as unknown;
      expect(environment).not.toHaveProperty('LLAME_WORKSPACE_AMBIENT_ONLY');
      const resolution = clients
        .resolverFor({ chatId, root, generation: 1 }, undefined)
        .resolveDynamicTool('mcp__stdio__search');
      expect(resolution.state).toBe('available');
    } finally {
      if (previous === undefined)
        delete process.env['LLAME_WORKSPACE_AMBIENT_ONLY'];
      else process.env['LLAME_WORKSPACE_AMBIENT_ONLY'] = previous;
      await clients.onModuleDestroy();
      await operator.stop();
      await rm(root, { recursive: true, force: true });
    }
  });

  it('enters a Workspace in a real bound Run and exposes the tool addition', async () => {
    const fixture = await httpFixture('entering-run');
    const root = await mkdtemp(join(tmpdir(), 'workspace-mcp-enter-'));
    const chatId = crypto.randomUUID();
    const operator = new McpRuntimeService({});
    const clients = new WorkspaceMcpClients(operator);
    try {
      await writeConfig(root, {
        web: { type: 'streamable-http', url: fixture.url },
      });
      const seeded = await tenantDb.runAs(userId, async (tx) => {
        await new ChatsRepository(tx).createIfAbsent({
          id: chatId,
          ownerUserId: userId,
          title: 'Workspace entry',
        });
        const message = await new MessagesRepository(tx).create({
          chatId,
          role: 'user',
          senderUserId: userId,
          parts: [{ type: 'text', text: 'Enter the Workspace.' }],
        });
        const run = await new RunsRepository(tx).create({
          chatId,
          messageId: message.id,
          userId,
          modelId: 'test:workspace-entry',
        });
        const started = await new RunsRepository(tx).markStarted(
          run.id,
          userId,
        );
        if (!started) throw new Error('Workspace entry Run did not start.');
        const event = await new RunEventsRepository(tx).append(
          run.id,
          'run.started',
        );
        return { runId: run.id, deliverySequence: event.sequence };
      });
      const bound = new Map<string, AttemptToolBinding>();
      const additions = new AttemptToolAdditions({
        allowedToolRules: ['mcp__web__*'],
        callTimeoutSeconds: 120,
        boundExecutables: bound,
        createTool: (declaration) => ({
          id: declaration.id,
          description: declaration.description,
          classification: 'unverified' as const,
          inputSchema: z.object({}),
          execute: () => ({ status: 'success' as const }),
        }),
      });
      const record = {};
      additions.bindToolRecord(record);
      const context = {
        runId: seeded.runId,
        nativeExecutorId: 'integration-worker',
        nativeDeliverySequence: seeded.deliverySequence,
        toolCallId: 'enter-workspace',
        userId,
        chatId,
        tenantDb,
        permissionPolicy: compileTestPermissionPolicy(),
        workspaceRoot: createWorkspaceRootCell(undefined),
        workspaceMcp: clients,
        toolAdditions: additions,
      };
      const entry = await enterWorkspaceTool.execute(context, { path: root });
      expect(entry).toMatchObject({
        status: 'success',
        mcpServers: [{ id: 'web', state: 'available' }],
      });
      const added = additions.executorFor('mcp__web__search');
      if (added === undefined) {
        throw new Error('Workspace entry did not bind the added executor.');
      }
      const callResult = await added.execute(
        {
          runId: seeded.runId,
          nativeDeliverySequence: seeded.deliverySequence,
          userId,
          chatId,
          tenantDb,
          toolCallId: 'added-tool-call',
        },
        {},
      );
      expect(JSON.stringify(callResult)).toContain('workspace-entering-run');
      context.workspaceRoot?.beginStep();
      const sameRoot = await enterWorkspaceTool.execute(
        { ...context, toolCallId: 'same-root-entry' },
        { path: root },
      );
      expect(sameRoot).toMatchObject({
        status: 'success',
        mcpServers: [{ id: 'web', state: 'available' }],
      });
      const chat = await tenantDb.runAs(userId, (tx) =>
        new ChatsRepository(tx).findById(chatId, userId),
      );
      if (chat === undefined || chat.workspaceRoot === null)
        throw new Error('Workspace was not bound.');
      const next = await clients.startForChat({
        chatId,
        root: chat.workspaceRoot,
        generation: chat.workspaceGeneration,
      });
      const catalog = await composeTurnToolCatalog({
        allowedToolRules: ['mcp__web__*'],
        callTimeoutSeconds: 120,
        candidates: clients.snapshotCandidates({
          chatId,
          root: chat.workspaceRoot,
          generation: chat.workspaceGeneration,
        }),
      });
      expect(catalog.admitted[0]?.declaration.id).toBe('mcp__web__search');
      expect(next.servers).toEqual([{ id: 'web', state: 'available' }]);
      context.workspaceRoot?.beginStep();
      const exited = await exitWorkspaceTool.execute(
        { ...context, toolCallId: 'exit-workspace' },
        {},
      );
      expect(exited).toMatchObject({
        status: 'success',
        state: 'exited',
      });
      const unavailable = additions.executorFor('mcp__web__search');
      if (unavailable === undefined) {
        throw new Error(
          'Workspace declaration was removed instead of disabled.',
        );
      }
      expect(
        unavailable.execute(
          {
            runId: seeded.runId,
            nativeDeliverySequence: seeded.deliverySequence,
            userId,
            chatId,
            tenantDb,
            toolCallId: 'after-exit',
          },
          {},
        ),
      ).toMatchObject({ type: 'not_available' });
    } finally {
      await tenantDb
        .runAs(userId, (tx) =>
          new WorkspaceBindingRepository(tx)
            .exit({
              chatId,
              ownerUserId: userId,
              runId: crypto.randomUUID(),
              deliverySequence: 0,
              executorId: 'integration-worker',
            })
            .catch(() => undefined),
        )
        .catch(() => undefined);
      await clients.onModuleDestroy();
      await operator.stop();
      await fixture.close();
      await rm(root, { recursive: true, force: true });
      await sql`DELETE FROM chats WHERE id = ${chatId}`;
    }
  });

  it('leaves entry successful when Workspace MCP files or transports are invalid', async () => {
    const malformedRoot = await mkdtemp(
      join(tmpdir(), 'workspace-mcp-bad-file-'),
    );
    const unsupportedRoot = await mkdtemp(
      join(tmpdir(), 'workspace-mcp-bad-type-'),
    );
    const chatId = crypto.randomUUID();
    const operator = new McpRuntimeService({});
    const clients = new WorkspaceMcpClients(operator);
    try {
      await writeFile(join(malformedRoot, '.mcp.json'), '{ malformed', 'utf8');
      await writeConfig(unsupportedRoot, {
        unsupported: { type: 'sse', url: 'http://127.0.0.1:1/mcp' },
      });
      const seeded = await tenantDb.runAs(userId, async (tx) => {
        await new ChatsRepository(tx).createIfAbsent({
          id: chatId,
          ownerUserId: userId,
          title: 'Workspace invalid config',
        });
        const message = await new MessagesRepository(tx).create({
          chatId,
          role: 'user',
          senderUserId: userId,
          parts: [{ type: 'text', text: 'Enter the Workspace.' }],
        });
        const run = await new RunsRepository(tx).create({
          chatId,
          messageId: message.id,
          userId,
          modelId: 'test:workspace-invalid',
        });
        const started = await new RunsRepository(tx).markStarted(
          run.id,
          userId,
        );
        if (!started)
          throw new Error('Workspace invalid-config Run did not start.');
        const event = await new RunEventsRepository(tx).append(
          run.id,
          'run.started',
        );
        return { runId: run.id, deliverySequence: event.sequence };
      });
      const context = {
        runId: seeded.runId,
        nativeExecutorId: 'integration-worker',
        nativeDeliverySequence: seeded.deliverySequence,
        toolCallId: 'enter-malformed',
        userId,
        chatId,
        tenantDb,
        permissionPolicy: compileTestPermissionPolicy(),
        workspaceMcp: clients,
      };

      const malformed = await enterWorkspaceTool.execute(context, {
        path: malformedRoot,
      });
      expect(malformed).toMatchObject({
        status: 'success',
        mcpServers: [
          {
            id: '.mcp.json',
            state: 'unavailable',
            reason: 'configuration file .mcp.json is malformed',
          },
        ],
      });

      const unsupported = await enterWorkspaceTool.execute(
        { ...context, toolCallId: 'enter-unsupported' },
        { path: unsupportedRoot },
      );
      expect(unsupported).toMatchObject({
        status: 'success',
        mcpServers: [
          {
            id: 'unsupported',
            state: 'unavailable',
            reason: 'unsupported transport sse',
          },
        ],
      });
    } finally {
      await clients.onModuleDestroy();
      await operator.stop();
      await rm(malformedRoot, { recursive: true, force: true });
      await rm(unsupportedRoot, { recursive: true, force: true });
      await sql`DELETE FROM chats WHERE id = ${chatId}`;
    }
  });
});
