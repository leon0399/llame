/**
 * Integration: per-user context is rendered and BOUND per run.
 *
 * The unit tests prove the projection and the render; these prove the wiring —
 * that two owners on one model bind their own values and never each other's,
 * and that a profile edit cannot reach a run already enqueued.
 *
 * Set TEST_DATABASE_URL to run (the test:integration globalSetup provisions it).
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import { type Sql } from 'postgres';

import * as schema from '../db/schema';
import { TenantDbService } from '../db/tenant-db.service';
import { BUILT_IN_DEFAULTS } from '../instance-config/llame-config';
import { type ModelSelectionValidator } from '../models/models.service';
import { ChatLoopService } from '../chats/chat-loop.service';
import { RunAbortRegistry } from '../runs/run-abort-registry';
import { RunsRepository } from '../runs/runs-repository';
import { ModelContextSnapshotsRepository } from '../runs/model-context-snapshots.repository';
import { PersonalizationRepository } from './personalization-repository';
import { PersonalizationService } from './personalization.service';
import { SystemPromptsService } from '../system-prompts/system-prompts.service';
import { MemoryService } from '../memory/memory.service';
import { RecencyDigestService } from '../chats/recency-digest.service';
import { type KnowledgeToolCandidateResolverPort } from '../knowledge/knowledge-tool-candidate-resolver';
import { TOOL_REGISTRY } from '../tools/registry';

export {};

const knowledgeCandidates: KnowledgeToolCandidateResolverPort = {
  resolve: () =>
    Promise.resolve(
      [...TOOL_REGISTRY.values()].map((tool) => ({
        source: { type: 'code_owned' as const },
        state: 'available' as const,
        tool,
      })),
    ),
};

const TEST_DB_URL = process.env['TEST_DATABASE_URL'];
const describeIfDb = TEST_DB_URL ? describe : describe.skip;

describeIfDb('personalization binds per run', () => {
  let sql: Sql;
  let tenantDb: TenantDbService;
  let chatLoop: ChatLoopService;
  let personalization: PersonalizationService;
  let userAId: string;
  let userBId: string;

  // A real template, rendered by the production SystemPromptsService — so this
  // test exercises the actual renderer (including its trim-means-absent rule)
  // rather than a stub that has to re-implement it and can drift from it.
  const SYSTEM_PROMPT_TEMPLATE =
    'Base prompt.' +
    '{{#if user.personalization.preferredName}} Name: {{user.personalization.preferredName}}{{/if}}' +
    '{{#if user.personalization.about}} About: {{user.personalization.about}}{{/if}}' +
    '{{#if user.email}} Email: {{user.email}}{{/if}}';

  const send = (userId: string, chatId: string, messageId: string) =>
    chatLoop.createMessageStream({
      chatId,
      userId,
      modelId: 'system:openai:gpt-5.4-mini',
      message: { id: messageId, parts: [{ type: 'text', text: 'hello' }] },
    });

  /** The system prompt actually bound to that chat's run. */
  const boundSnapshot = async (userId: string, chatId: string) =>
    tenantDb.runAs(userId, async (tx) => {
      const [run] = await new RunsRepository(tx).findByChatId(chatId, userId);
      const snapshot = await new ModelContextSnapshotsRepository(
        tx,
      ).findByOwnedRun(run.id, userId);
      return snapshot!;
    });

  const boundPrompt = async (userId: string, chatId: string) =>
    (await boundSnapshot(userId, chatId)).systemPrompt;

  beforeAll(async () => {
    const postgres = await import('postgres');
    const connect = postgres.default ?? postgres;
    const ssl = /sslmode=require/.test(TEST_DB_URL!) ? 'require' : false;
    sql = connect(TEST_DB_URL!, { ssl, max: 5 });
    tenantDb = new TenantDbService(drizzle(sql, { schema }));
    personalization = new PersonalizationService(tenantDb);

    userAId = crypto.randomUUID();
    userBId = crypto.randomUUID();
    await sql`INSERT INTO users (id, name, email) VALUES (${userAId}, 'Bind A', ${`bind-a-${userAId}@test.com`})`;
    await sql`INSERT INTO users (id, name, email) VALUES (${userBId}, 'Bind B', ${`bind-b-${userBId}@test.com`})`;

    const models: ModelSelectionValidator = {
      validateModelSelection: (modelId: string) => ({
        id: modelId,
        source: 'system' as const,
        contextWindowTokens: 128_000,
        provider: 'openai',
        providerModelId: modelId,
        systemPromptTemplate: SYSTEM_PROMPT_TEMPLATE,
        systemPromptSource: 'project_default' as const,
      }),
      // No reasoning vocabulary on this double: effort always resolves to
      // "none".
      resolveEffortSelection: () => undefined,
    };

    chatLoop = new ChatLoopService(
      tenantDb,
      models,
      // Every value this test needs IS the built-in default, so use them
      // rather than restating a config that would silently drift from them.
      { config: BUILT_IN_DEFAULTS },
      // Typed, no cast: ChatLoopService depends on the method, not the class.
      // This test never consumes the response — it asserts on what was BOUND.
      { createUiMessageStreamResponse: () => new Response(null) },
      new RunAbortRegistry(),
      { dispatch: () => Promise.resolve() },
      personalization,
      new SystemPromptsService(),
      { snapshotCandidates: () => [] },
      new MemoryService(tenantDb),
      new RecencyDigestService(tenantDb),
      knowledgeCandidates,
    );
  });

  afterAll(async () => {
    if (sql) {
      await sql`DELETE FROM users WHERE id IN (${userAId}, ${userBId})`;
      await sql.end();
    }
  });

  it('binds each owner their own values and neither the other owner’s', async () => {
    await personalization.updateForOwner(userAId, {
      preferredName: 'Ana',
      about: 'A private about text',
    });
    await personalization.updateForOwner(userBId, {
      preferredName: 'Bee',
      about: 'B private about text',
    });

    const chatA = crypto.randomUUID();
    const chatB = crypto.randomUUID();
    await send(userAId, chatA, crypto.randomUUID());
    await send(userBId, chatB, crypto.randomUUID());

    const promptA = await boundPrompt(userAId, chatA);
    const promptB = await boundPrompt(userBId, chatB);

    expect(promptA).toContain('Name: Ana');
    expect(promptA).toContain('A private about text');
    expect(promptA).not.toContain('Bee');
    expect(promptA).not.toContain('B private about text');

    expect(promptB).toContain('Name: Bee');
    expect(promptB).not.toContain('Ana');
    expect(promptB).not.toContain('A private about text');
  });

  it('an edit after enqueue does not change the already-bound run', async () => {
    await personalization.updateForOwner(userAId, { preferredName: 'Before' });

    const chatId = crypto.randomUUID();
    await send(userAId, chatId, crypto.randomUUID());
    const bound = await boundPrompt(userAId, chatId);
    expect(bound).toContain('Name: Before');

    // The owner edits immediately after enqueue…
    await personalization.updateForOwner(userAId, { preferredName: 'After' });

    // …and the run keeps what it bound. Retry reuses this snapshot, so the
    // answer stays reproducible.
    expect(await boundPrompt(userAId, chatId)).toBe(bound);
    expect(await boundPrompt(userAId, chatId)).not.toContain('After');

    // The NEXT run picks the new value up.
    const nextChat = crypto.randomUUID();
    await send(userAId, nextChat, crypto.randomUUID());
    expect(await boundPrompt(userAId, nextChat)).toContain('Name: After');
  });

  it('withholds account identity until the owner opts in, then binds it', async () => {
    await personalization.updateForOwner(userAId, {
      preferredName: 'Ana',
      shareAccountIdentity: false,
    });
    const withheldChat = crypto.randomUUID();
    await send(userAId, withheldChat, crypto.randomUUID());
    expect(await boundPrompt(userAId, withheldChat)).not.toContain('Email:');

    await personalization.updateForOwner(userAId, {
      shareAccountIdentity: true,
    });
    const sharedChat = crypto.randomUUID();
    await send(userAId, sharedChat, crypto.randomUUID());
    expect(await boundPrompt(userAId, sharedChat)).toContain(
      `Email: bind-a-${userAId}@test.com`,
    );
  });

  it('disabling personalization stops everything, including identity', async () => {
    await personalization.updateForOwner(userAId, {
      enabled: false,
      shareAccountIdentity: true,
    });

    const chatId = crypto.randomUUID();
    await send(userAId, chatId, crypto.randomUUID());
    const bound = await boundPrompt(userAId, chatId);

    expect(bound).toBe('Base prompt.');
    expect(bound).not.toContain('Ana');
    expect(bound).not.toContain('Email:');

    await personalization.updateForOwner(userAId, { enabled: true });
  });

  it('an owner with nothing to render binds the same prompt as no owner at all', async () => {
    // Content-addressed snapshots must keep deduping, or every unpersonalized
    // run writes a fresh full-prompt row.
    const emptyUserId = crypto.randomUUID();
    await sql`INSERT INTO users (id, name, email) VALUES (${emptyUserId}, 'Empty', ${`empty-${emptyUserId}@test.com`})`;

    const chatId = crypto.randomUUID();
    await send(emptyUserId, chatId, crypto.randomUUID());
    const first = await boundSnapshot(emptyUserId, chatId);
    expect(first.systemPrompt).toBe('Base prompt.');

    await tenantDb.runAs(emptyUserId, (tx) =>
      new PersonalizationRepository(tx).upsertForOwner(emptyUserId, {
        about: '   ',
      }),
    );
    const secondChat = crypto.randomUUID();
    await send(emptyUserId, secondChat, crypto.randomUUID());
    const second = await boundSnapshot(emptyUserId, secondChat);

    // Identical TEXT would pass even if dedup broke and a fresh row were
    // written per run, so assert the content address itself: same hash means
    // the same snapshot row was reused.
    expect(second.systemPrompt).toBe('Base prompt.');
    expect(second.contentHash).toBe(first.contentHash);
    expect(second.id).toBe(first.id);

    await sql`DELETE FROM users WHERE id = ${emptyUserId}`;
  });
});
