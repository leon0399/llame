import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import postgres, { type Sql } from 'postgres';
import { vi } from 'vitest';
import { ZodError } from 'zod';
import { hashWithDomain } from '../canonical-json';
import {
  digestColumnsFingerprint,
  parseDigestExportDocument,
  type DigestExportDocument,
  type DigestExportRecord,
} from './recency-digest-export';
import {
  RECENCY_DIGEST_UPGRADE_WITNESS,
  upgradeRecencyDigest,
} from './recency-digest-upgrade';
import { runRecencyDigestUpgrade } from './recency-digest-upgrade.cli';
import {
  defaultReceiptProvesTitle,
  exportedValueHasPromptProof,
  immutableIdentityHasProof,
  noticePinHasProof,
  originalRunHasPromptProof,
} from './recency-digest-upgrade-proofs';
import { readDigestPayload } from '../chats/recency-digest-item';
import {
  createContextItemPart,
  isContextItemPart,
} from '../chats/context-item';

const SYSTEM_PROMPT_RECEIPT_DOMAIN = 'llame:model-context:prompt:v1';
let retireDigestMigrationSql: string;
const schemaName = `digest_upgrade_${randomUUID().replaceAll('-', '')}`;
let admin: Sql;
let sql: Sql;
let freshContainer: StartedPostgreSqlContainer;
let freshSql: Sql;

function emptyDocument(
  records: Array<DigestExportRecord> = [],
): DigestExportDocument {
  return {
    version: 1,
    exporter: 'recency-digest-export/1',
    exportedAt: new Date().toISOString(),
    records,
  };
}

function makeRecord(input: {
  ownerId: string;
  chatId: string;
  runId: string | null;
  attemptId?: string;
  legacyColumns: {
    baseline: unknown;
    told: unknown;
    rebakedFrom: string | null;
  };
  title?: string;
  sourceChatId?: string;
  prompt?: string;
  fingerprint?: string;
}): DigestExportRecord {
  const attemptId = input.attemptId ?? randomUUID();

  const proof =
    input.runId && input.prompt
      ? {
          runId: input.runId,
          attemptId,
          promptHash: hashWithDomain(
            SYSTEM_PROMPT_RECEIPT_DOMAIN,
            input.prompt,
          ),
        }
      : undefined;

  return {
    ownerUserId: input.ownerId,
    chatId: input.chatId,
    fingerprint:
      input.fingerprint ?? digestColumnsFingerprint(input.legacyColumns),
    baseline: {
      ...(input.title && proof
        ? {
            entries: [
              {
                list: 'pinned',
                index: 0,
                fields: { title: input.title },
                proofs: { title: proof },
              },
            ],
          }
        : { entries: [] }),
      omissions: [],
    },
    comparison: {
      entries:
        input.title && proof
          ? [
              {
                chatId: input.sourceChatId ?? randomUUID(),
                pinned: true,
                title: input.title,
                proofs: { identity: proof, pin: { kind: 'baseline', proof } },
              },
            ]
          : [],
      omissions: [],
    },
    provenance: {
      originalRun: input.runId,
      attemptId: input.runId ? attemptId : null,
      activeCheckpointId: null,
      latestPreTurn: input.runId ? { runId: input.runId, seq: 1 } : null,
      lastOriginalSeq: 1,
    },
    omissions: [],
  };
}

async function createSchema(connection: Sql, name: string): Promise<void> {
  await connection.unsafe(`create schema "${name}"`);
  await connection.unsafe(`
    create table "${name}".chats (
      id uuid primary key, owner_user_id text not null,
      recency_digest_baseline jsonb, recency_digest_told jsonb, recency_digest_rebaked_from uuid
    );
    create table "${name}".messages (
      id uuid primary key default gen_random_uuid(), chat_id uuid not null, seq bigint not null,
      role text not null, sender_user_id text, absorbed_through_seq bigint, parts json not null, attachments jsonb not null default '[]'::jsonb
    );
    create table "${name}".runs (id uuid primary key, user_id text not null, chat_id uuid not null, message_id uuid, created_at timestamptz not null default now());
    create table "${name}".system_prompt_receipts (
      owner_user_id text not null, run_id uuid not null, attempt_id uuid not null,
      prompt_hash text not null, system_prompt text not null, source text not null
    );
    create table "${name}".run_events (
      run_id uuid not null, event_type text not null, payload jsonb not null
    );
    alter table "${name}".chats enable row level security;
    alter table "${name}".chats force row level security;
    create policy chats_owner on "${name}".chats using (owner_user_id = current_setting('app.current_user_id', true));
    alter table "${name}".messages enable row level security;
    alter table "${name}".messages force row level security;
    create policy messages_owner on "${name}".messages using (chat_id in (select id from "${name}".chats where owner_user_id = current_setting('app.current_user_id', true)));
    alter table "${name}".runs enable row level security;
    alter table "${name}".runs force row level security;
    create policy runs_owner on "${name}".runs using (user_id = current_setting('app.current_user_id', true));
    alter table "${name}".system_prompt_receipts enable row level security;
    alter table "${name}".system_prompt_receipts force row level security;
    create policy receipts_owner on "${name}".system_prompt_receipts using (owner_user_id = current_setting('app.current_user_id', true));
    alter table "${name}".run_events enable row level security;
    alter table "${name}".run_events force row level security;
    create policy events_owner on "${name}".run_events using (run_id in (select id from "${name}".runs where user_id = current_setting('app.current_user_id', true)));
  `);
}

async function seedChat(input: {
  ownerId: string;
  chatId: string;
  runId?: string;
  attemptId?: string;
  prompt?: string;
  initialTold?: unknown;
  columns: {
    baseline: unknown;
    told: unknown;
    rebakedFrom: string | null;
  };
}): Promise<void> {
  await sql.begin(async (tx) => {
    await tx`select set_config('app.current_user_id', ${input.ownerId}, true)`;
    await tx`
      insert into chats (id, owner_user_id, recency_digest_baseline, recency_digest_told, recency_digest_rebaked_from)
      values (${input.chatId}::uuid, ${input.ownerId}, ${JSON.stringify(input.columns.baseline)}::text::jsonb, ${JSON.stringify(input.columns.told)}::text::jsonb, ${input.columns.rebakedFrom}::uuid)
    `;

    if (input.runId && input.attemptId && input.prompt) {
      const promptHash = hashWithDomain(
        SYSTEM_PROMPT_RECEIPT_DOMAIN,
        input.prompt,
      );

      const triggerMessageId = randomUUID();
      await tx`insert into messages (id, chat_id, seq, role, sender_user_id, parts) values (${triggerMessageId}::uuid, ${input.chatId}::uuid, 1, 'user', ${input.ownerId}, '[]'::json)`;
      await tx`insert into runs (id, user_id, chat_id, message_id) values (${input.runId}::uuid, ${input.ownerId}, ${input.chatId}::uuid, ${triggerMessageId}::uuid)`;
      await tx`insert into system_prompt_receipts (owner_user_id, run_id, attempt_id, prompt_hash, system_prompt, source) values (${input.ownerId}, ${input.runId}::uuid, ${input.attemptId}::uuid, ${promptHash}, ${input.prompt}, 'project_default')`;
      await tx`insert into run_events (run_id, event_type, payload) values (${input.runId}::uuid, 'model.requested', ${JSON.stringify({ attemptId: input.attemptId })}::text::jsonb)`;
      await tx`insert into run_events (run_id, event_type, payload) values (${input.runId}::uuid, 'run.suspended', ${JSON.stringify({ summaryAttemptId: input.attemptId, baselines: { recencyDigestInitialization: { baseline: input.columns.baseline, told: input.initialTold ?? input.columns.told } } })}::text::jsonb)`;
    }
  });
}

describe('recency digest data upgrade', () => {
  beforeAll(async () => {
    retireDigestMigrationSql = await readFile(
      path.resolve(
        process.cwd(),
        'src/db/migrations/20261124014016_retire_recency_digest_columns/migration.sql',
      ),
      'utf8',
    );
    freshContainer = await new PostgreSqlContainer(
      'pgvector/pgvector:pg17@sha256:cf134a767f474095eeba57e0117be8e568e011a63f33fbf252f14c9b760f8e6f',
    ).start();
    freshSql = postgres(freshContainer.getConnectionUri(), { max: 1 });
    await freshSql.unsafe(
      "CREATE ROLE app LOGIN PASSWORD 'app' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE",
    );
    await freshSql.unsafe('CREATE DATABASE digest_upgrade_test OWNER app');
    const databaseUrl = new URL(freshContainer.getConnectionUri());
    databaseUrl.pathname = '/digest_upgrade_test';
    databaseUrl.username = 'app';
    databaseUrl.password = 'app';
    admin = postgres(databaseUrl.href, { max: 1 });
    sql = postgres(databaseUrl.href, {
      max: 1,
      connection: { options: `-c search_path=${schemaName},public` },
    });
  });

  beforeEach(async () => {
    await admin.unsafe(`drop schema if exists "${schemaName}" cascade`);
    await createSchema(admin, schemaName);
  });

  afterAll(async () => {
    try {
      if (sql) await sql.end();

      if (admin) {
        await admin.unsafe(`drop schema if exists "${schemaName}" cascade`);
        await admin.end();
      }

      if (freshSql) await freshSql.end();
    } finally {
      if (freshContainer) await freshContainer.stop();
    }
  });
  it('proves fresh inventory from catalog absence and sets the transaction witness', async () => {
    await freshSql.begin(async (tx) => {
      const report = await upgradeRecencyDigest(
        tx,
        emptyDocument(),
        async () => {
          const [witness] = await tx<
            Array<{ value: string | null }>
          >`select current_setting(${RECENCY_DIGEST_UPGRADE_WITNESS}, true) as value`;

          expect(witness?.value).toBe('v1');
        },
      );

      expect(report).toEqual({
        inventoryChats: 0,
        importedChats: 0,
        omittedChats: 0,
        omissions: [],
      });
    });
  });

  it('cleans failed operator reports, writes a private report, and refuses to replace it', async () => {
    await freshSql.unsafe('CREATE ROLE app_rls NOLOGIN BYPASSRLS');
    await freshSql.unsafe('CREATE DATABASE digest_cli_test');
    const databaseUrl = new URL(freshContainer.getConnectionUri());
    databaseUrl.pathname = '/digest_cli_test';
    const connection = postgres(databaseUrl.href, { max: 1 });

    const directory = await mkdtemp(
      path.join(tmpdir(), 'llame-digest-upgrade-'),
    );

    const exportPath = path.join(directory, 'export.json');
    const reportPath = path.join(directory, 'report.json');

    try {
      await writeFile(exportPath, JSON.stringify(emptyDocument()), {
        mode: 0o600,
      });
      const unavailableDatabase = new URL(databaseUrl);
      unavailableDatabase.pathname = '/digest_cli_unavailable';
      vi.stubEnv('POSTGRES_URL', unavailableDatabase.href);
      await expect(
        runRecencyDigestUpgrade([
          '--export',
          exportPath,
          '--report',
          reportPath,
        ]),
      ).rejects.toMatchObject({ code: '3D000' });
      await expect(stat(reportPath)).rejects.toMatchObject({ code: 'ENOENT' });
      vi.stubEnv('POSTGRES_URL', databaseUrl.href);
      await runRecencyDigestUpgrade([
        '--report',
        reportPath,
        '--export',
        exportPath,
      ]);
      const reportText = await readFile(reportPath, 'utf8');
      const report: unknown = JSON.parse(reportText);
      expect(report).toEqual({
        inventoryChats: 0,
        importedChats: 0,
        omittedChats: 0,
        omissions: [],
      });
      expect((await stat(reportPath)).mode & 0o777).toBe(0o600);

      const [catalog] = await connection<
        Array<{ relation: string | null; legacyColumns: number }>
      >`
        select to_regclass('public.chats')::text as relation,
          (select count(*)::integer from information_schema.columns
           where table_schema = 'public' and table_name = 'chats'
             and column_name in ('recency_digest_baseline', 'recency_digest_told',
               'recency_digest_rebaked_from')) as "legacyColumns"
      `;

      expect(catalog).toEqual({ relation: 'chats', legacyColumns: 0 });
      await expect(
        runRecencyDigestUpgrade([
          '--export',
          exportPath,
          '--report',
          reportPath,
        ]),
      ).rejects.toMatchObject({ code: 'EEXIST' });
      expect(await readFile(reportPath, 'utf8')).toBe(reportText);
    } finally {
      vi.unstubAllEnvs();
      await connection.end();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('rejects v1 comparison entries without immutable identity and pin proofs', () => {
    const ownerId = 'proof-schema-owner';
    const chatId = randomUUID();
    const runId = randomUUID();
    const prompt = 'Disclosed title';

    const record = makeRecord({
      ownerId,
      chatId,
      runId,
      prompt,
      title: 'Disclosed title',
      legacyColumns: { baseline: null, told: null, rebakedFrom: null },
    });

    const entry = record.comparison.entries[0];

    if (!entry)
      throw new Error('Migration proof fixture could not be constructed');

    const invalid = {
      version: 1,
      exporter: 'recency-digest-export/1',
      exportedAt: new Date().toISOString(),
      records: [
        {
          ...record,
          comparison: {
            ...record.comparison,
            entries: [
              {
                chatId: entry.chatId,
                pinned: entry.pinned,
                title: entry.title,
              },
            ],
          },
        },
      ],
    };

    expect(() => parseDigestExportDocument(invalid)).toThrow(ZodError);
  });

  it('binds exported proofs to the receipt owner, Chat, run, attempt, hash and request event', async () => {
    const ownerId = 'proof-binding-owner';
    const chatId = randomUUID();
    const sourceChatId = randomUUID();
    const runId = randomUUID();
    const attemptId = randomUUID();
    const noticeMessageId = randomUUID();
    const title = 'Receipt-bound title';
    const prompt = `Disclosed ${title}`;

    const columns = {
      baseline: { pinned: [{ title }], recent: [] },
      told: [{ chatId: sourceChatId, title, pinned: true }],
      rebakedFrom: null,
    };

    await seedChat({ ownerId, chatId, runId, attemptId, prompt, columns });
    await seedChat({
      ownerId,
      chatId: sourceChatId,
      columns: { baseline: null, told: null, rebakedFrom: null },
    });

    const record = makeRecord({
      ownerId,
      chatId,
      runId,
      attemptId,
      prompt,
      title,
      sourceChatId,
      legacyColumns: columns,
    });

    const entry = record.comparison.entries[0];

    if (!entry)
      throw new Error('Migration proof fixture could not be constructed');

    await sql.begin(async (tx) => {
      await tx`select set_config('app.current_user_id', ${ownerId}, true)`;
      const absentEventAttemptId = randomUUID();
      await tx`insert into system_prompt_receipts (owner_user_id, run_id, attempt_id, prompt_hash, system_prompt, source) values (${ownerId}, ${runId}::uuid, ${absentEventAttemptId}::uuid, ${hashWithDomain(SYSTEM_PROMPT_RECEIPT_DOMAIN, prompt)}, ${prompt}, 'project_default')`;

      const noticePart = createContextItemPart({
        producer: 'recency-digest',
        form: 'notice',
        runId,
        payload: { entries: [], pinChanges: [{ title, pinned: true }] },
        text: 'The previously announced Chat is now pinned.',
      });

      await tx`insert into messages (id, chat_id, seq, role, sender_user_id, parts) values (${noticeMessageId}::uuid, ${chatId}::uuid, 2, 'assistant', null, ${JSON.stringify([noticePart])}::text::json)`;

      const input = {
        connection: tx,
        run: {
          ownerId,
          chatId,
          proof: entry.proofs.identity,
          value: title,
        },
      };

      expect(await exportedValueHasPromptProof(input)).toBe(true);
      expect(
        await exportedValueHasPromptProof({
          ...input,
          run: { ...input.run, ownerId: 'different-owner' },
        }),
      ).toBe(false);
      expect(
        await exportedValueHasPromptProof({
          ...input,
          run: { ...input.run, chatId: randomUUID() },
        }),
      ).toBe(false);
      expect(
        await exportedValueHasPromptProof({
          ...input,
          run: {
            ...input.run,
            proof: { ...input.run.proof, runId: randomUUID() },
          },
        }),
      ).toBe(false);
      expect(
        await exportedValueHasPromptProof({
          ...input,
          run: {
            ...input.run,
            proof: { ...input.run.proof, attemptId: randomUUID() },
          },
        }),
      ).toBe(false);
      expect(
        await exportedValueHasPromptProof({
          ...input,
          run: {
            ...input.run,
            proof: { ...input.run.proof, promptHash: '0'.repeat(64) },
          },
        }),
      ).toBe(false);
      expect(
        await exportedValueHasPromptProof({
          ...input,
          run: {
            ...input.run,
            proof: { ...input.run.proof, attemptId: absentEventAttemptId },
          },
        }),
      ).toBe(false);
      record.provenance.lastOriginalSeq = 2;
      const wrongNoticeMessageId = randomUUID();
      expect(
        await noticePinHasProof({
          connection: tx,
          chat: {
            id: chatId,
            owner_user_id: ownerId,
            recency_digest_told: columns.told,
          },
          record,
          entry: {
            ...entry,
            proofs: {
              ...entry.proofs,
              pin: { kind: 'notice', messageId: wrongNoticeMessageId },
            },
          },
          cutoffSupported: true,
        }),
      ).toEqual({ effectiveCorrection: true, proofMatches: false });
      expect(
        await noticePinHasProof({
          connection: tx,
          chat: {
            id: chatId,
            owner_user_id: ownerId,
            recency_digest_told: columns.told,
          },
          record,
          entry: {
            ...entry,
            proofs: {
              ...entry.proofs,
              pin: { kind: 'notice', messageId: noticeMessageId },
            },
          },
          cutoffSupported: true,
        }),
      ).toEqual({ effectiveCorrection: true, proofMatches: true });
      expect(
        await originalRunHasPromptProof({
          connection: tx,
          run: { ownerId, chatId, runId, attemptId },
        }),
      ).toBe(true);
      expect(
        await originalRunHasPromptProof({
          connection: tx,
          run: { ownerId: 'different-owner', chatId, runId, attemptId },
        }),
      ).toBe(false);
      expect(
        await defaultReceiptProvesTitle({
          connection: tx,
          run: { ownerId, chatId, proof: entry.proofs.identity, title },
        }),
      ).toBe(true);
      expect(
        await immutableIdentityHasProof({
          connection: tx,
          ownerId,
          chatId,
          legacyBaseline: columns.baseline,
          rebakedFrom: null,
          entry,
        }),
      ).toBe(true);
      expect(
        await immutableIdentityHasProof({
          connection: tx,
          ownerId,
          chatId,
          legacyBaseline: { pinned: [], recent: [] },
          rebakedFrom: null,
          entry,
        }),
      ).toBe(false);
      expect(
        await immutableIdentityHasProof({
          connection: tx,
          ownerId,
          chatId,
          legacyBaseline: columns.baseline,
          rebakedFrom: randomUUID(),
          entry,
        }),
      ).toBe(false);

      const nonDefaultAttempt = randomUUID();
      const promptHash = hashWithDomain(SYSTEM_PROMPT_RECEIPT_DOMAIN, prompt);
      await tx`insert into system_prompt_receipts (owner_user_id, run_id, attempt_id, prompt_hash, system_prompt, source) values (${ownerId}, ${runId}::uuid, ${nonDefaultAttempt}::uuid, ${promptHash}, ${prompt}, 'user_override')`;
      await tx`insert into run_events (run_id, event_type, payload) values (${runId}::uuid, 'model.requested', ${JSON.stringify({ attemptId: nonDefaultAttempt })}::text::jsonb)`;

      const nonDefaultProof = {
        ...entry.proofs.identity,
        attemptId: nonDefaultAttempt,
      };

      expect(
        await exportedValueHasPromptProof({
          connection: tx,
          run: { ownerId, chatId, proof: nonDefaultProof, value: title },
        }),
      ).toBe(true);
      expect(
        await defaultReceiptProvesTitle({
          connection: tx,
          run: { ownerId, chatId, proof: nonDefaultProof, title },
        }),
      ).toBe(false);
      expect(
        await immutableIdentityHasProof({
          connection: tx,
          ownerId,
          chatId,
          legacyBaseline: columns.baseline,
          rebakedFrom: null,
          entry: {
            ...entry,
            proofs: {
              ...entry.proofs,
              identity: nonDefaultProof,
            },
          },
        }),
      ).toBe(false);
      expect(
        await exportedValueHasPromptProof({
          connection: tx,
          run: {
            ownerId,
            chatId,
            proof: { ...entry.proofs.identity, attemptId: randomUUID() },
            value: title,
          },
        }),
      ).toBe(false);
    });
  });

  it('keeps independently proved baseline fields when the pin receipt source is not a default', async () => {
    const ownerId = 'independent-proof-owner';
    const chatId = randomUUID();
    const sourceChatId = randomUUID();
    const runId = randomUUID();
    const attemptId = randomUUID();
    const excerptAttemptId = randomUUID();
    const title = 'Default-only pin title';
    const excerpt = 'Independently disclosed excerpt';
    const prompt = `Disclosed ${title}; ${excerpt}`;

    const columns = {
      baseline: { pinned: [{ title, excerpt }], recent: [] },
      told: [{ chatId: sourceChatId, title, pinned: true }],
      rebakedFrom: null,
    };

    await seedChat({ ownerId, chatId, runId, attemptId, prompt, columns });
    await seedChat({
      ownerId,
      chatId: sourceChatId,
      columns: { baseline: null, told: null, rebakedFrom: null },
    });
    await sql.begin(async (tx) => {
      await tx`select set_config('app.current_user_id', ${ownerId}, true)`;
      const promptHash = hashWithDomain(SYSTEM_PROMPT_RECEIPT_DOMAIN, prompt);
      await tx`insert into system_prompt_receipts (owner_user_id, run_id, attempt_id, prompt_hash, system_prompt, source) values (${ownerId}, ${runId}::uuid, ${excerptAttemptId}::uuid, ${promptHash}, ${prompt}, 'user_override')`;
      await tx`insert into run_events (run_id, event_type, payload) values (${runId}::uuid, 'model.requested', ${JSON.stringify({ attemptId: excerptAttemptId })}::text::jsonb)`;
    });

    const record = makeRecord({
      ownerId,
      chatId,
      runId,
      attemptId,
      prompt,
      title,
      sourceChatId,
      legacyColumns: columns,
    });

    const baselineEntry = record.baseline.entries[0];
    const comparison = record.comparison.entries[0];

    if (!baselineEntry || !comparison)
      throw new Error('Migration proof fixture could not be constructed');
    baselineEntry.fields.excerpt = excerpt;
    baselineEntry.proofs.excerpt = {
      runId,
      attemptId: excerptAttemptId,
      promptHash: hashWithDomain(SYSTEM_PROMPT_RECEIPT_DOMAIN, prompt),
    };
    comparison.proofs.pin = {
      kind: 'baseline',
      proof: {
        ...comparison.proofs.identity,
        attemptId: excerptAttemptId,
      },
    };

    const report = await sql.begin(async (tx) =>
      upgradeRecencyDigest(tx, emptyDocument([record]), () =>
        Promise.resolve(),
      ),
    );

    expect(report.importedChats).toBe(1);
    expect(
      report.omissions.some(
        ({ chatId: omittedChatId, field }) =>
          omittedChatId === chatId && field === 'comparison.pin',
      ),
    ).toBe(true);
    await sql.begin(async (tx) => {
      await tx`select set_config('app.current_user_id', ${ownerId}, true)`;

      const carriers = await tx<Array<{ parts: unknown }>>`
        select parts from messages
        where chat_id = ${chatId}::uuid and sender_user_id is null and role = 'user'
        order by seq
      `;

      const digestParts = carriers.flatMap(({ parts }) =>
        Array.isArray(parts) ? parts.filter(isContextItemPart) : [],
      );

      const baselinePart = digestParts.find(
        (part) => readDigestPayload(part)?.kind === 'baseline',
      );

      const noticePart = digestParts.find(
        (part) => readDigestPayload(part)?.kind === 'notice',
      );

      expect(digestParts).toHaveLength(2);
      expect(
        baselinePart && readDigestPayload(baselinePart)?.announced,
      ).toEqual([]);
      expect(baselinePart?.data.text).toContain(title);
      expect(baselinePart?.data.text).toContain(excerpt);
      expect(noticePart && readDigestPayload(noticePart)?.announced).toEqual(
        [],
      );
      expect(carriers).toHaveLength(2);
    });
  });

  it('imports only proved per-owner rows, restores FORCE, resets identity before SQL, and rolls back/retries atomically', async () => {
    const ownerA = 'owner-a';
    const ownerB = 'owner-b';
    const chatA = randomUUID();
    const chatB = randomUUID();
    const staleChat = randomUUID();
    const absentRunChat = randomUUID();
    const misboundChat = randomUUID();
    const noProofChat = randomUUID();
    const legacyValueMismatchAttempt = randomUUID();
    const staleProofChat = randomUUID();
    const legacyValueMismatchChat = randomUUID();
    const legacyValueMismatchRun = randomUUID();
    const staleProofRun = randomUUID();
    const staleProofAttempt = randomUUID();
    const runA = randomUUID();
    const runB = randomUUID();
    const attemptA = randomUUID();
    const attemptB = randomUUID();
    const sourceA = randomUUID();
    const sourceB = randomUUID();

    const legacyA = {
      baseline: {
        pinned: [
          { title: 'Alpha', excerpt: 'unproved old text must not leak' },
        ],
        recent: [],
      },
      told: [{ chatId: sourceA, title: 'Alpha', pinned: true }],
      rebakedFrom: null,
    };

    const legacyB = {
      baseline: { pinned: [{ title: 'Beta' }], recent: [] },
      told: [{ chatId: sourceB, title: 'Beta', pinned: true }],
      rebakedFrom: null,
    };

    const staleLegacy = {
      baseline: { pinned: [], recent: [] },
      told: [],
      rebakedFrom: null,
    };

    const noProofLegacy = {
      baseline: { pinned: [{ title: 'Unproved' }], recent: [] },
      told: [],
      rebakedFrom: null,
    };

    const legacyValueMismatch = {
      baseline: { pinned: [{ title: 'Actual legacy title' }], recent: [] },
      told: [],
      rebakedFrom: null,
    };

    const staleProofLegacy = {
      baseline: { pinned: [{ title: 'Stale proof' }], recent: [] },
      told: [],
      rebakedFrom: null,
    };

    const legacyValueMismatchPrompt = 'Prompt proved Forged export title';
    const promptA = 'Prompt showed Alpha';
    const staleProofPrompt = 'Prompt showed Stale proof';
    const promptB = 'Prompt showed Beta';

    for (const fixture of [
      {
        ownerId: ownerA,
        chatId: chatA,
        runId: runA,
        attemptId: attemptA,
        prompt: promptA,
        columns: legacyA,
      },
      {
        ownerId: ownerB,
        chatId: chatB,
        runId: runB,
        attemptId: attemptB,
        prompt: promptB,
        columns: legacyB,
      },
      { ownerId: ownerA, chatId: staleChat, columns: staleLegacy },
      { ownerId: ownerA, chatId: absentRunChat, columns: noProofLegacy },
      { ownerId: ownerB, chatId: misboundChat, columns: noProofLegacy },
      { ownerId: ownerB, chatId: noProofChat, columns: noProofLegacy },
      {
        ownerId: ownerA,
        chatId: staleProofChat,
        runId: staleProofRun,
        attemptId: staleProofAttempt,
        prompt: staleProofPrompt,
        columns: staleProofLegacy,
      },
      {
        ownerId: ownerA,
        chatId: legacyValueMismatchChat,
        runId: legacyValueMismatchRun,
        attemptId: legacyValueMismatchAttempt,
        prompt: legacyValueMismatchPrompt,
        columns: legacyValueMismatch,
      },
      {
        ownerId: ownerA,
        chatId: sourceA,
        columns: { baseline: null, told: null, rebakedFrom: null },
      },
      {
        ownerId: ownerB,
        chatId: sourceB,
        columns: { baseline: null, told: null, rebakedFrom: null },
      },
    ])
      await seedChat(fixture);

    const records = [
      makeRecord({
        ownerId: ownerA,
        chatId: chatA,
        runId: runA,
        attemptId: attemptA,
        prompt: promptA,
        title: 'Alpha',
        sourceChatId: sourceA,
        legacyColumns: legacyA,
      }),
      makeRecord({
        ownerId: ownerB,
        chatId: chatB,
        runId: runB,
        attemptId: attemptB,
        prompt: promptB,
        title: 'Beta',
        sourceChatId: sourceB,
        legacyColumns: legacyB,
      }),
      makeRecord({
        ownerId: ownerA,
        chatId: staleChat,
        runId: null,
        legacyColumns: staleLegacy,
        fingerprint: '0'.repeat(64),
      }),
      makeRecord({
        ownerId: ownerA,
        chatId: absentRunChat,
        runId: null,
        legacyColumns: noProofLegacy,
      }),
      makeRecord({
        ownerId: ownerA,
        chatId: misboundChat,
        runId: null,
        legacyColumns: noProofLegacy,
      }),
      makeRecord({
        ownerId: ownerB,
        chatId: noProofChat,
        runId: null,
        legacyColumns: noProofLegacy,
      }),
      makeRecord({
        ownerId: ownerA,
        chatId: staleProofChat,
        runId: staleProofRun,
        attemptId: staleProofAttempt,
        prompt: staleProofPrompt,
        title: 'Stale proof',
        legacyColumns: staleProofLegacy,
      }),
      makeRecord({
        ownerId: ownerA,
        chatId: legacyValueMismatchChat,
        runId: legacyValueMismatchRun,
        attemptId: legacyValueMismatchAttempt,
        prompt: legacyValueMismatchPrompt,
        title: 'Forged export title',
        legacyColumns: legacyValueMismatch,
      }),
      makeRecord({
        ownerId: ownerA,
        chatId: sourceA,
        runId: null,
        legacyColumns: { baseline: null, told: null, rebakedFrom: null },
      }),
      makeRecord({
        ownerId: ownerB,
        chatId: sourceB,
        runId: null,
        legacyColumns: { baseline: null, told: null, rebakedFrom: null },
      }),
    ];

    const misbound = records[4];
    const staleProof = records[6];
    const staleTitleProof = staleProof?.baseline.entries[0]?.proofs.title;

    if (staleTitleProof) staleTitleProof.promptHash = '0'.repeat(64);

    if (misbound) misbound.ownerUserId = 'different-owner';

    const countVisibleMessages = async (): Promise<number> =>
      sql.begin(async (tx) => {
        await tx`select set_config('app.current_user_id', ${ownerA}, true)`;

        const [row] = await tx<Array<{ count: number }>>`
          select count(*)::int as count from messages
        `;

        return row?.count ?? 0;
      });

    const messagesBefore = await countVisibleMessages();

    await expect(
      sql.begin(async (tx) => {
        await tx`select set_config('app.current_user_id', ${ownerA}, true)`;
        await upgradeRecencyDigest(tx, emptyDocument(records), () => {
          throw new Error('Injected pending SQL failure');
        });
      }),
    ).rejects.toThrow('Injected pending SQL failure');

    expect(await countVisibleMessages()).toBe(messagesBefore);

    const report = await sql.begin(async (tx) => {
      await tx`select set_config('app.current_user_id', ${ownerA}, true)`;

      return upgradeRecencyDigest(tx, emptyDocument(records), async () => {
        const [identity] = await tx<
          Array<{ value: string | null }>
        >`select current_setting('app.current_user_id', true) as value`;

        const [force] = await tx<
          Array<{ forced: boolean }>
        >`select relforcerowsecurity as forced from pg_class where relname = 'chats' and relnamespace = current_schema()::regnamespace`;

        const [witness] = await tx<
          Array<{ value: string | null }>
        >`select current_setting(${RECENCY_DIGEST_UPGRADE_WITNESS}, true) as value`;

        expect(identity?.value).toBe('');
        expect(force?.forced).toBe(true);
        expect(witness?.value).toBe('v1');
        await tx.unsafe(retireDigestMigrationSql);
      });
    });

    expect(report.inventoryChats).toBe(10);
    expect(report.importedChats).toBe(2);
    expect(report.omittedChats).toBe(6);
    expect(
      report.omissions.some(
        ({ chatId, reason }) =>
          chatId === staleChat && reason === 'legacy_fingerprint_mismatch',
      ),
    ).toBe(true);
    expect(
      report.omissions.some(
        ({ chatId, reason }) =>
          chatId === absentRunChat && reason === 'original_run_unavailable',
      ),
    ).toBe(true);
    expect(
      report.omissions.some(
        ({ chatId, reason }) =>
          chatId === misboundChat && reason === 'misbound_export_record',
      ),
    ).toBe(true);
    expect(report.omissions.some(({ chatId }) => chatId === noProofChat)).toBe(
      true,
    );
    expect(
      report.omissions.some(
        ({ chatId, reason }) =>
          chatId === legacyValueMismatchChat &&
          reason === 'legacy_value_mismatch_title',
      ),
    ).toBe(true);
    expect(
      report.omissions.some(
        ({ chatId, reason }) =>
          chatId === staleProofChat && reason.startsWith('unsupported_'),
      ),
    ).toBe(true);
    await sql.begin(async (tx) => {
      await tx`select set_config('app.current_user_id', ${ownerA}, true)`;

      const visible = await tx<
        Array<{ chat_id: string; parts: unknown }>
      >`select chat_id::text, parts from messages where sender_user_id is null order by chat_id, seq`;

      expect(visible).toHaveLength(2);
      expect(JSON.stringify(visible)).not.toContain(
        'unproved old text must not leak',
      );
      expect(
        visible.every(
          ({ parts }) => Array.isArray(parts) && parts.length === 1,
        ),
      ).toBe(true);

      const payloads = visible.flatMap(({ parts }) =>
        Array.isArray(parts)
          ? parts.flatMap((part) =>
              isContextItemPart(part) ? [readDigestPayload(part)] : [],
            )
          : [],
      );

      expect(
        payloads
          .map((payload) => payload?.kind)
          .sort((a, b) => (a ?? '').localeCompare(b ?? '')),
      ).toEqual(['baseline', 'notice']);

      const ownerBRows =
        await tx`select id from messages where chat_id = ${chatB}::uuid`;

      expect(ownerBRows).toHaveLength(0);
    });

    await sql.begin(async (tx) => {
      const rerun = await upgradeRecencyDigest(tx, emptyDocument(records), () =>
        Promise.resolve(),
      );

      expect(rerun).toEqual({
        inventoryChats: 0,
        importedChats: 0,
        omittedChats: 0,
        omissions: [],
      });
    });
  });

  it('keeps late pin state out of the baseline when current told titles became ambiguous', async () => {
    const ownerId = 'notice-owner';
    const chatId = randomUUID();
    const sourceChatId = randomUUID();
    const otherChatId = randomUUID();
    const runId = randomUUID();
    const attemptId = randomUUID();
    const checkpointId = randomUUID();
    const noticeMessageId = randomUUID();
    const latestCheckpointId = randomUUID();
    const latestTurnId = randomUUID();
    const title = 'Previously recent Chat';
    const prompt = `Previously disclosed ${title}`;

    const columns = {
      baseline: { pinned: [], recent: [{ title }] },
      told: [
        { chatId: sourceChatId, title, pinned: false },
        { chatId: otherChatId, title, pinned: false },
      ],
      rebakedFrom: null,
    };

    await seedChat({
      ownerId,
      chatId,
      runId,
      attemptId,
      prompt,
      columns,
      initialTold: [{ chatId: sourceChatId, title, pinned: false }],
    });
    await seedChat({
      ownerId,
      chatId: otherChatId,
      columns: { baseline: null, told: null, rebakedFrom: null },
    });
    await seedChat({
      ownerId,
      chatId: sourceChatId,
      columns: { baseline: null, told: null, rebakedFrom: null },
    });
    await sql.begin(async (tx) => {
      await tx`select set_config('app.current_user_id', ${ownerId}, true)`;
      await tx`insert into messages (id, chat_id, seq, role, sender_user_id, absorbed_through_seq, parts) values (${checkpointId}::uuid, ${chatId}::uuid, 2, 'checkpoint', null, 1, '[]'::text::json)`;
      await tx`insert into messages (id, chat_id, seq, role, sender_user_id, absorbed_through_seq, parts) values (${latestCheckpointId}::uuid, ${chatId}::uuid, 6, 'checkpoint', null, 4, '[]'::text::json)`;

      const noticePart = createContextItemPart({
        producer: 'recency-digest',
        form: 'notice',
        runId,
        payload: { entries: [], pinChanges: [{ title, pinned: true }] },
        text: 'A previously announced Chat is now pinned.',
      });

      await tx`insert into messages (id, chat_id, seq, role, sender_user_id, parts) values (${noticeMessageId}::uuid, ${chatId}::uuid, 5, 'assistant', null, ${JSON.stringify([noticePart])}::text::json)`;
      await tx`insert into messages (id, chat_id, seq, role, sender_user_id, parts) values (${latestTurnId}::uuid, ${chatId}::uuid, 4, 'user', ${ownerId}, '[]'::text::json)`;
      await tx`update runs set message_id = ${latestTurnId}::uuid where id = ${runId}::uuid`;
    });

    const record = makeRecord({
      ownerId,
      chatId,
      runId,
      attemptId,
      prompt,
      title,
      sourceChatId,
      legacyColumns: columns,
    });

    const baselineEntry = record.baseline.entries[0];
    const comparison = record.comparison.entries[0];

    if (!baselineEntry || !comparison)
      throw new Error('Migration proof fixture could not be constructed');
    baselineEntry.list = 'recent';
    comparison.proofs.pin = { kind: 'notice', messageId: noticeMessageId };
    record.provenance.activeCheckpointId = latestCheckpointId;
    record.provenance.latestPreTurn = { runId, seq: 4 };
    record.provenance.lastOriginalSeq = 6;

    const report = await sql.begin(async (tx) =>
      upgradeRecencyDigest(tx, emptyDocument([record]), () =>
        Promise.resolve(),
      ),
    );

    expect(
      report.omissions.some(
        (item) =>
          item.reason === 'unproved_told_id' &&
          item.relatedChatId === otherChatId,
      ),
    ).toBe(true);
    await sql.begin(async (tx) => {
      await tx`select set_config('app.current_user_id', ${ownerId}, true)`;

      const carriers = await tx<Array<{ parts: unknown }>>`
        select parts from messages where chat_id = ${chatId}::uuid and sender_user_id is null and role = 'user' order by seq
      `;

      expect(JSON.stringify(carriers)).toContain(title);

      const payloads = carriers.flatMap(({ parts }) =>
        Array.isArray(parts)
          ? parts.flatMap((part) =>
              isContextItemPart(part) ? [readDigestPayload(part)] : [],
            )
          : [],
      );

      expect(payloads[0]).toMatchObject({
        kind: 'baseline',
        announced: [],
        association: { kind: 'checkpoint', checkpointId: latestCheckpointId },
      });
      expect(payloads[1]).toMatchObject({
        kind: 'notice',
        announced: [],
        importedCutoff: { latestTurnSeq: 4, lastOriginalSeq: 6 },
      });
    });
  });

  it('uses the latest host trigger and the oldest run sharing that trigger', async () => {
    const ownerId = 'latest-trigger-owner';
    const chatId = randomUUID();
    const sourceChatId = randomUUID();
    const originalRunId = randomUUID();
    const originalAttemptId = randomUUID();
    const competingRunId = randomUUID();
    const competingAttemptId = randomUUID();
    const latestTriggerId = randomUUID();
    const title = 'Latest triggered Chat';
    const prompt = `Disclosed ${title}`;

    const columns = {
      baseline: { pinned: [], recent: [{ title }] },
      told: [{ chatId: sourceChatId, title, pinned: false }],
      rebakedFrom: null,
    };

    await seedChat({
      ownerId,
      chatId,
      runId: originalRunId,
      attemptId: originalAttemptId,
      prompt,
      columns,
    });
    await seedChat({
      ownerId,
      chatId: sourceChatId,
      columns: { baseline: null, told: null, rebakedFrom: null },
    });

    await sql.begin(async (tx) => {
      await tx`select set_config('app.current_user_id', ${ownerId}, true)`;
      await tx`insert into messages (id, chat_id, seq, role, sender_user_id, parts) values (${latestTriggerId}::uuid, ${chatId}::uuid, 2, 'user', ${ownerId}, '[]'::text::json)`;
      await tx`update runs set message_id = ${latestTriggerId}::uuid, created_at = '2020-01-01T00:00:00Z' where id = ${originalRunId}::uuid`;
      await tx`insert into runs (id, user_id, chat_id, message_id, created_at) values (${competingRunId}::uuid, ${ownerId}, ${chatId}::uuid, ${latestTriggerId}::uuid, '2021-01-01T00:00:00Z')`;
      await tx`insert into system_prompt_receipts (owner_user_id, run_id, attempt_id, prompt_hash, system_prompt, source) values (${ownerId}, ${competingRunId}::uuid, ${competingAttemptId}::uuid, ${hashWithDomain(SYSTEM_PROMPT_RECEIPT_DOMAIN, prompt)}, ${prompt}, 'project_default')`;
      await tx`insert into run_events (run_id, event_type, payload) values (${competingRunId}::uuid, 'model.requested', ${JSON.stringify({ attemptId: competingAttemptId })}::text::jsonb)`;
      await tx`insert into run_events (run_id, event_type, payload) values (${competingRunId}::uuid, 'run.suspended', ${JSON.stringify({ summaryAttemptId: competingAttemptId, baselines: { recencyDigestInitialization: { baseline: columns.baseline, told: columns.told } } })}::text::jsonb)`;
    });

    const record = makeRecord({
      ownerId,
      chatId,
      runId: originalRunId,
      attemptId: originalAttemptId,
      prompt,
      title,
      sourceChatId,
      legacyColumns: columns,
    });

    const baselineEntry = record.baseline.entries[0];
    const comparison = record.comparison.entries[0];

    if (!baselineEntry || !comparison)
      throw new Error('Migration proof fixture could not be constructed');
    baselineEntry.list = 'recent';
    comparison.pinned = false;
    record.provenance.latestPreTurn = { runId: originalRunId, seq: 2 };
    record.provenance.lastOriginalSeq = 2;

    const report = await sql.begin(async (tx) =>
      upgradeRecencyDigest(tx, emptyDocument([record]), () =>
        Promise.resolve(),
      ),
    );

    expect(report.importedChats).toBe(1);
    await sql.begin(async (tx) => {
      await tx`select set_config('app.current_user_id', ${ownerId}, true)`;

      const [notice] = await tx<Array<{ parts: unknown }>>`
        select parts from messages where chat_id = ${chatId}::uuid and sender_user_id is null and role = 'user' order by seq desc limit 1
      `;

      const part: unknown = Array.isArray(notice?.parts)
        ? notice.parts[0]
        : undefined;

      const payload = isContextItemPart(part)
        ? readDigestPayload(part)
        : undefined;

      expect(payload).toMatchObject({
        kind: 'notice',
        importedCutoff: { latestTurnSeq: 2, lastOriginalSeq: 2 },
      });
    });
  });

  it('does not let a baseline pin proof override a later notice', async () => {
    const ownerId = 'baseline-pin-owner';
    const chatId = randomUUID();
    const sourceChatId = randomUUID();
    const runId = randomUUID();
    const attemptId = randomUUID();
    const noticeId = randomUUID();
    const title = 'Later unpinned title';
    const prompt = `Disclosed ${title}`;

    const columns = {
      baseline: { pinned: [{ title }], recent: [] },
      told: [{ chatId: sourceChatId, title, pinned: true }],
      rebakedFrom: null,
    };

    await seedChat({
      ownerId,
      chatId,
      runId,
      attemptId,
      prompt,
      columns,
      initialTold: columns.told,
    });
    await seedChat({
      ownerId,
      chatId: sourceChatId,
      columns: { baseline: null, told: null, rebakedFrom: null },
    });
    await sql.begin(async (tx) => {
      await tx`select set_config('app.current_user_id', ${ownerId}, true)`;

      const part = createContextItemPart({
        producer: 'recency-digest',
        form: 'notice',
        runId,
        payload: { entries: [], pinChanges: [{ title, pinned: false }] },
        text: 'The title is no longer pinned.',
      });

      await tx`insert into messages (id, chat_id, seq, role, sender_user_id, parts) values (${noticeId}::uuid, ${chatId}::uuid, 2, 'assistant', null, ${JSON.stringify([part])}::text::json)`;
    });

    const record = makeRecord({
      ownerId,
      chatId,
      runId,
      attemptId,
      prompt,
      title,
      sourceChatId,
      legacyColumns: columns,
    });

    record.provenance.latestPreTurn = { runId, seq: 1 };
    record.provenance.lastOriginalSeq = 2;

    const report = await sql.begin(async (tx) =>
      upgradeRecencyDigest(tx, emptyDocument([record]), () =>
        Promise.resolve(),
      ),
    );

    expect(report.importedChats).toBe(1);
    await sql.begin(async (tx) => {
      await tx`select set_config('app.current_user_id', ${ownerId}, true)`;

      const carriers = await tx<Array<{ parts: unknown }>>`
        select parts from messages where chat_id = ${chatId}::uuid and sender_user_id is null and role = 'user'
      `;

      expect(JSON.stringify(carriers)).toContain(title);

      const announced = carriers.flatMap(({ parts }) =>
        Array.isArray(parts)
          ? parts.flatMap((part) =>
              isContextItemPart(part)
                ? (readDigestPayload(part)?.announced ?? [])
                : [],
            )
          : [],
      );

      expect(announced).toEqual([]);
    });
    expect(
      report.omissions.some(
        ({ chatId: omittedChatId, reason }) =>
          omittedChatId === chatId &&
          reason === 'effective_pin_proof_unavailable',
      ),
    ).toBe(true);
  });
  it('does not reuse first-epoch identity after a byte-identical rebake', async () => {
    const ownerId = 'rebaked-identity-owner';
    const chatId = randomUUID();
    const sourceChatId = randomUUID();
    const runId = randomUUID();
    const attemptId = randomUUID();
    const title = 'Identical baseline title';
    const prompt = `Disclosed ${title}`;

    const columns = {
      baseline: { pinned: [{ title }], recent: [] },
      told: [{ chatId: sourceChatId, title, pinned: true }],
      rebakedFrom: randomUUID(),
    };

    await seedChat({ ownerId, chatId, runId, attemptId, prompt, columns });
    await seedChat({
      ownerId,
      chatId: sourceChatId,
      columns: { baseline: null, told: null, rebakedFrom: null },
    });

    const record = makeRecord({
      ownerId,
      chatId,
      runId,
      attemptId,
      prompt,
      title,
      sourceChatId,
      legacyColumns: columns,
    });

    const report = await sql.begin(async (tx) =>
      upgradeRecencyDigest(tx, emptyDocument([record]), () =>
        Promise.resolve(),
      ),
    );

    expect(report.omissions).toContainEqual({
      chatId,
      field: 'comparison.identity',
      reason: 'immutable_identity_proof_unavailable',
    });
    await sql.begin(async (tx) => {
      await tx`select set_config('app.current_user_id', ${ownerId}, true)`;

      const rows = await tx<Array<{ parts: unknown }>>`
        select parts from messages where chat_id = ${chatId}::uuid and role = 'user' and sender_user_id is null
      `;

      expect(JSON.stringify(rows)).not.toContain(sourceChatId);
    });
  });
  it('fails closed when a legacy migration attempts deletion without a witness', async () => {
    await expect(
      sql.begin((tx) => tx.unsafe(retireDigestMigrationSql)),
    ).rejects.toMatchObject({ code: 'P0001' });
  });
});
