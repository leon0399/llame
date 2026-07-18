/**
 * Compaction lineage e2e (#57) — real HTTP + Postgres, fake model client.
 *
 * Proves compaction-AFTER-compaction end to end: the second compaction must
 * read the previous summary + only the messages after its uptoSeq — never the
 * full history — and the next chat turn must likewise see summary + delta.
 * The unit tests cover each piece (repo sinceSeq predicate, planner, request
 * builder); this spec proves the composed loop against a live database.
 *
 * Requires POSTGRES_URL to point at a migrated database. Without it the suite
 * is skipped so offline `pnpm test` remains usable.
 */

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { configureApp } from './../src/app.setup';
import { TenantDbService } from './../src/db/tenant-db.service';
import { CompactionsRepository } from './../src/chats/chats-repository';
import { COMPACTION_INSTRUCTION } from './../src/compaction/compaction';
import {
  CONVERSATION_CHECKPOINT_START,
  renderConversationCheckpoint,
} from './../src/chats/context-builder';
import { type Compaction } from './../src/db/schema';
import { ModelsService } from './../src/models/models.service';
import { FakeModelsService, type FakeTurn, cookieOf } from './support';

const hasDb = !!process.env.POSTGRES_URL;
const d = hasDb ? describe : describe.skip;

// Each turn is a full HTTP stream + fire-and-forget compaction poll.
jest.setTimeout(30_000);

d('compaction lineage over HTTP (#57)', () => {
  let app: INestApplication;
  let http: import('http').Server;
  let models: FakeModelsService;
  let tenantDb: TenantDbService;

  // Random (not Date.now()): parallel jest workers evaluate this at the same
  // millisecond often enough to collide on the registration email.
  const tag = crypto.randomUUID();
  let cookie = '';
  let userId = '';

  beforeAll(async () => {
    models = new FakeModelsService();
    // With the fake client's real usage (totalTokens: 8) every completed
    // turn crosses this threshold, so compaction triggers as soon as the
    // live window outgrows the keep-recent cap (providers-and-models-as-code,
    // #167: per-model override, replacing the removed COMPACTION_TOKEN_THRESHOLD
    // env var).
    models.client.compactionThresholdTokens = 1;
    const mod = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ModelsService)
      .useValue(models)
      .compile();

    app = mod.createNestApplication();
    configureApp(app);
    await app.init();
    http = app.getHttpServer() as import('http').Server;
    tenantDb = app.get(TenantDbService);

    const res = await request(http)
      .post('/auth/v1/register')
      .send({
        email: `compact-${tag}@example.com`,
        password: 'password123',
        name: 'Compact',
      });
    expect(res.status).toBe(201);
    cookie = cookieOf(res);
    userId = (res.body as { user: { id: string } }).user.id;
  });

  afterAll(async () => {
    await app?.close();
  });

  async function sendTurn(chatId: string, text: string): Promise<void> {
    const res = await request(http)
      .post(`/api/v1/chats/${chatId}/messages`)
      .set('Cookie', cookie)
      .send({
        modelId: 'system:openai:gpt-5.4-mini',
        message: {
          id: crypto.randomUUID(),
          parts: [{ type: 'text', text }],
        },
      });
    expect(res.status).toBe(200);
  }

  /** Polls for the chat's latest compaction until it differs from `after`. */
  async function waitForCompaction(
    chatId: string,
    after: Compaction | undefined,
  ): Promise<Compaction> {
    const started = Date.now();
    for (;;) {
      const latest = await tenantDb.runAs(userId, (tx) =>
        new CompactionsRepository(tx).findLatestByChatId(chatId, userId),
      );
      if (latest && latest.id !== after?.id) {
        return latest;
      }
      if (Date.now() - started > 10_000) {
        throw new Error('Timed out waiting for a compaction row');
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  /** The compaction model calls, identified by their trailing instruction. */
  function compactionCalls(): FakeTurn[] {
    return models.client.turns.filter(
      (t) => t.messages.at(-1)?.content === COMPACTION_INSTRUCTION,
    );
  }

  // ModelMessage.content is string | parts — the v0.1 loop always sends
  // flattened strings, but stringify defensively so lint (and a future
  // structured-parts regression) can't hide behind '[object Object]'.
  function contentText(content: unknown): string {
    return typeof content === 'string' ? content : JSON.stringify(content);
  }

  function texts(turn: FakeTurn): string {
    return turn.messages.map((m) => contentText(m.content)).join('\n');
  }

  it('re-compaction absorbs the previous summary + only the delta, never the full history', async () => {
    // Distinct reply per model call, so summaries and replies are all unique
    // and "which text appears where" assertions cannot alias.
    models.client.responses = Array.from({ length: 20 }, (_, i) => `out-${i}`);
    const chatId = crypto.randomUUID();

    // keep-recent is 8 messages; each turn persists 2 (user + assistant).
    // Turns 1–4 stay within the keep window (absorb would be empty → no row);
    // turn 5 makes the live window 10 messages → first compaction absorbs 2.
    for (let i = 1; i <= 5; i++) {
      await sendTurn(chatId, `turn-${i}`);
    }
    const first = await waitForCompaction(chatId, undefined);
    expect(first.parentId).toBeNull();

    // First compaction: no earlier summary — its request replays raw turns
    // and must contain the oldest message.
    const firstCall = compactionCalls()[0];
    expect(texts(firstCall)).toContain('turn-1');
    expect(texts(firstCall)).not.toContain(CONVERSATION_CHECKPOINT_START);

    // One more turn: the post-compaction window outgrows keep-recent again
    // and a SECOND compaction lands on top of the first.
    await sendTurn(chatId, 'turn-6');
    const second = await waitForCompaction(chatId, first);

    // Lineage: the second row chains to the first and supersedes more history.
    expect(second.parentId).toBe(first.id);
    expect(second.uptoSeq).toBeGreaterThan(first.uptoSeq);

    // The second compaction's model input is summary + delta, NOT full history:
    // it leads with the first summary (rendered exactly like a live turn) and
    // must not replay any message the first compaction already absorbed.
    const secondCall = compactionCalls().find((t) =>
      contentText(t.messages[0]?.content).startsWith(
        CONVERSATION_CHECKPOINT_START,
      ),
    );
    expect(secondCall).toBeDefined();
    expect(texts(secondCall!)).toContain(first.summary);
    expect(texts(secondCall!)).not.toContain('turn-1\n');
    expect(texts(secondCall!)).not.toContain(
      contentText(firstCall.messages[1]?.content),
    );

    // And the NEXT chat turn reads the same shape: latest summary + live
    // window only — turns absorbed by either compaction never re-enter
    // the prompt.
    await sendTurn(chatId, 'turn-7');
    const lastChatTurn = models.client.turns
      .filter((t) => t.messages.at(-1)?.content !== COMPACTION_INSTRUCTION)
      .at(-1)!;
    expect(contentText(lastChatTurn.messages[0]?.content)).toBe(
      renderConversationCheckpoint(second.summary),
    );
    expect(texts(lastChatTurn)).not.toContain('turn-1\n');
    expect(texts(lastChatTurn)).not.toContain('turn-2\n');
    expect(texts(lastChatTurn)).toContain('turn-7');
  });
});
