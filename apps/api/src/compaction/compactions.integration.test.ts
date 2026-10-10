/**
 * Compaction lineage e2e (#57) — real HTTP + Postgres, fake model client.
 *
 * Proves compaction-AFTER-compaction end to end: the second compaction must
 * read the previous summary + only the messages after its uptoSeq — never the
 * full history — and the next chat turn must likewise see summary + delta.
 * Compaction is one synchronous trigger before a turn's first model request
 * (unify-compaction-checkpoints D4), so the row a turn publishes exists when
 * that turn's response has ended, and the user message that triggered it is
 * never part of what it summarizes.
 * The unit tests cover each piece (repo sinceSeq predicate, planner, request
 * builder); this spec proves the composed loop against a live database.
 *
 * Requires POSTGRES_URL to point at a migrated database. Without it the suite
 * is skipped so offline `pnpm test` remains usable.
 */

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../app.module';
import { CanonicalSearchCoverageService } from '../search/canonical-search-activation.service';
import { configureApp } from '../app.setup';
import { TenantDbService } from '../db/tenant-db.service';
import { MessagesRepository } from '../chats/messages-repository';
import { COMPACTION_INSTRUCTION } from '../compaction/compaction';
import { readCheckpointText } from '../chats/context-item-producers';
import { ModelsService } from '../models/models.service';
import {
  FakeModelsService,
  type FakeTurn,
  cookieOf,
  expectRegisteredUserId,
} from '../testing/support';
import { isString } from '@workspace/runtime-safety';

const hasDb = !!process.env.POSTGRES_URL;
const d = hasDb ? describe : describe.skip;

// Each turn is a full HTTP stream.
vi.setConfig({ testTimeout: 30_000 });

d('compaction lineage over HTTP (#57)', () => {
  let app: INestApplication<import('http').Server>;
  let http: import('http').Server;
  let models: FakeModelsService;
  let tenantDb: TenantDbService;

  // Random (not Date.now()): parallel test workers evaluate this at the same
  // millisecond often enough to collide on the registration email.
  const tag = crypto.randomUUID();
  let cookie = '';
  let userId = '';

  beforeAll(async () => {
    models = new FakeModelsService();
    // A one-token threshold is crossed by any non-empty request, so every turn
    // that has committed rows before its own user message compacts them before
    // its first model request (providers-and-models-as-code, #167: per-model
    // override, replacing the removed COMPACTION_TOKEN_THRESHOLD env var).
    models.client.compactionThresholdTokens = 1;
    const mod = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(CanonicalSearchCoverageService)
      .useValue({ assertReady: () => Promise.resolve() })
      .overrideProvider(ModelsService)
      .useValue(models)
      .compile();

    app = mod.createNestApplication();
    configureApp(app);
    await app.listen(0);
    http = app.getHttpServer();
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
    const registerBody: unknown = res.body;
    expectRegisteredUserId(registerBody);
    userId = registerBody.user.id;
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

  const latestCheckpoint = async (chatId: string) => {
    const rows = await tenantDb.runAs(userId, (tx) =>
      new MessagesRepository(tx).findByChatId(chatId, userId),
    );
    return rows
      .filter((row) => row.role === 'checkpoint')
      .sort((a, b) => b.seq - a.seq)[0];
  };

  /** The `seq` of the user message a turn sent, found by its text. */
  async function userSeq(chatId: string, text: string): Promise<number> {
    const rows = await tenantDb.runAs(userId, (tx) =>
      new MessagesRepository(tx).findByChatId(chatId, userId),
    );
    const row = rows.find(
      (message) =>
        message.role === 'user' && JSON.stringify(message.parts).includes(text),
    );
    if (row === undefined) {
      throw new Error(`No user message carries ${text}`);
    }
    return row.seq;
  }

  /** The compaction model calls, identified by their trailing instruction. */
  function compactionCalls(): Array<FakeTurn> {
    return models.client.turns.filter(
      (t) => t.messages.at(-1)?.content === COMPACTION_INSTRUCTION,
    );
  }

  // ModelMessage.content is string | parts — the v0.1 loop always sends
  // flattened strings, but stringify defensively so lint (and a future
  // structured-parts regression) can't hide behind '[object Object]'.
  // eslint-disable-next-line anti-slop/no-unknown-parameters -- validated inline by the ternary test below (`isString(content) ? content : JSON.stringify(content)`); the check is the ternary's test, a shape the structural exemption's `if`/`return`-of-boolean parse doesn't unwrap.
  function contentText(content: unknown): string {
    return isString(content) ? content : JSON.stringify(content);
  }

  function texts(turn: FakeTurn): string {
    return turn.messages.map((m) => contentText(m.content)).join('\n');
  }

  function storedCheckpointText(
    message: FakeTurn['messages'][number] | undefined,
  ): string | null {
    if (message?.role !== 'user') return null;
    const content = message.content;
    if (!Array.isArray(content) || content.length !== 1) return null;
    const part = content[0];
    return part.type === 'text' ? part.text : null;
  }

  it('re-compaction absorbs the previous summary + only the delta, never the full history', async () => {
    // Distinct reply per model call, so summaries and replies are all unique
    // and "which text appears where" assertions cannot alias.
    models.client.responses = Array.from({ length: 40 }, (_, i) => `out-${i}`);
    const chatId = crypto.randomUUID();

    // Turn 1: nothing lies between the (absent) boundary and the first user
    // message, so the trigger is a no-op even over the threshold.
    await sendTurn(chatId, 'turn-1');
    expect(compactionCalls()).toHaveLength(0);
    expect(await latestCheckpoint(chatId)).toBeUndefined();

    // Turn 2: its trigger absorbs turn 1 whole — no keep-recent window — and
    // the row is there when the response ends, because it was written before
    // the turn's first model request.
    await sendTurn(chatId, 'turn-2');
    const first = await latestCheckpoint(chatId);
    if (first === undefined) {
      throw new Error('Expected turn 2 to publish a compaction row');
    }
    expect(first.absorbedThroughSeq).toBe(
      (await userSeq(chatId, 'turn-2')) - 1,
    );

    // First compaction: no earlier summary — its request replays raw turns,
    // must contain the oldest message, and never the message that triggered it.
    expect(compactionCalls()).toHaveLength(1);
    const firstCall = compactionCalls()[0];
    expect(texts(firstCall)).toContain('turn-1');
    expect(texts(firstCall)).not.toContain('turn-2');
    // No checkpoint envelope in the raw-turn replay: the request is built from
    // conversation rows only. The content is stringified, so the envelope's
    // quotes may be escaped.
    expect(texts(firstCall)).not.toMatch(
      /<system-reminder producer=\\?"compaction\\?" form=\\?"checkpoint\\?">/u,
    );

    // Turn 3: its trigger absorbs only what lies above the first boundary,
    // and the second compaction lands on top of the first.
    await sendTurn(chatId, 'turn-3');
    const second = await latestCheckpoint(chatId);
    if (second === undefined) {
      throw new Error('Expected turn 3 to publish a compaction row');
    }

    // Lineage: the second row chains to the first and supersedes more history.
    expect(second.absorbedThroughSeq).toBeGreaterThan(
      first.absorbedThroughSeq!,
    );
    expect(second.absorbedThroughSeq).toBe(
      (await userSeq(chatId, 'turn-3')) - 1,
    );

    // The second compaction's model input is the exact stored replacement +
    // delta, NOT full history: turn 2 and its reply, never the absorbed turn 1
    // and never turn 3, whose message triggered it.
    const firstCheckpoint = readCheckpointText(first);
    // The fake model answers call N with `out-N`, so the first compaction call's
    // summary is known without reading it back through the replay helpers.
    const firstSummary = `out-${models.client.turns.indexOf(firstCall)}`;
    expect(firstCheckpoint).toMatch(
      /^<system-reminder producer="compaction" form="checkpoint">/u,
    );
    expect(firstCheckpoint).toContain(firstSummary);
    expect(compactionCalls()).toHaveLength(2);
    const secondCall = compactionCalls().find(
      (turn) => storedCheckpointText(turn.messages[0]) === firstCheckpoint,
    );
    expect(secondCall).toBeDefined();
    expect(secondCall!.messages[0]).toEqual({
      role: 'user',
      content: [{ type: 'text', text: firstCheckpoint }],
    });
    expect(secondCall!.messages.slice(1, -1).map((m) => m.role)).toEqual([
      'user',
      'assistant',
    ]);
    expect(texts(secondCall!)).toContain('turn-2');
    expect(texts(secondCall!)).not.toContain('turn-1');
    expect(texts(secondCall!)).not.toContain('turn-3');

    // And the NEXT chat turn reads the same shape: latest summary + live
    // window only — turns absorbed by any compaction never re-enter the
    // prompt.
    await sendTurn(chatId, 'turn-4');
    const third = await latestCheckpoint(chatId);
    if (third === undefined) {
      throw new Error('Expected turn 4 to publish a compaction row');
    }
    const lastChatTurn = models.client.turns
      .filter((t) => t.messages.at(-1)?.content !== COMPACTION_INSTRUCTION)
      .at(-1)!;
    expect(lastChatTurn.messages[0]).toEqual({
      role: 'user',
      content: [{ type: 'text', text: readCheckpointText(third) }],
    });
    expect(texts(lastChatTurn)).not.toContain('turn-1');
    expect(texts(lastChatTurn)).not.toContain('turn-2');
    expect(texts(lastChatTurn)).not.toContain('turn-3');
    expect(texts(lastChatTurn)).toContain('turn-4');
  });
});
