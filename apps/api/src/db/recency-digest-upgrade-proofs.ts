import { isRecord, type UnknownRecord } from '@workspace/runtime-safety';
import { isContextItemPart } from '../chats/context-item';
import { z } from 'zod';
import { canonicalJson, hashWithDomain } from '../canonical-json';
import { sanitizeAuthoredText } from '../instance-config/authored-text';
import type { Sql } from 'postgres';
import type {
  DigestExportProof,
  DigestExportRecord,
} from './recency-digest-export';

const SYSTEM_PROMPT_RECEIPT_DOMAIN = 'llame:model-context:prompt:v1';

type OwnedRun = { ownerId: string; chatId: string };

type OwnedPromptReceipt = {
  system_prompt: string;
  prompt_hash: string;
  source: string;
};

async function readOwnedPromptReceipt(input: {
  connection: Sql;
  run: OwnedRun & { runId: string; attemptId: string };
  promptHash?: string;
}): Promise<OwnedPromptReceipt | undefined> {
  const { connection, run, promptHash } = input;

  const [receipt] = await connection<Array<OwnedPromptReceipt>>`
    select receipt.system_prompt, receipt.prompt_hash, receipt.source
    from runs r
    join system_prompt_receipts receipt
      on receipt.run_id = r.id and receipt.owner_user_id = r.user_id
     and receipt.attempt_id = ${run.attemptId}::uuid
     and (${promptHash ?? null}::text is null or receipt.prompt_hash = ${promptHash ?? null})
    where r.id = ${run.runId}::uuid and r.user_id = ${run.ownerId} and r.chat_id = ${run.chatId}::uuid
      and exists (
        select 1 from run_events event
        where event.run_id = r.id and event.event_type = 'model.requested'
          and event.payload ->> 'attemptId' = ${run.attemptId}
      )
  `;

  return receipt;
}

export async function exportedValueHasPromptProof(input: {
  connection: Sql;
  run: OwnedRun & { proof: DigestExportProof; value: string | number };
}): Promise<boolean> {
  const { connection } = input;
  const { ownerId, chatId, proof, value } = input.run;

  const receipt = await readOwnedPromptReceipt({
    connection,
    run: {
      ownerId,
      chatId,
      runId: proof.runId,
      attemptId: proof.attemptId,
    },
    promptHash: proof.promptHash,
  });

  return (
    receipt?.prompt_hash === proof.promptHash &&
    hashWithDomain(SYSTEM_PROMPT_RECEIPT_DOMAIN, receipt.system_prompt) ===
      proof.promptHash &&
    receipt.system_prompt.includes(sanitizeAuthoredText(String(value)))
  );
}

export async function originalRunHasPromptProof(input: {
  connection: Sql;
  run: OwnedRun & { runId: string; attemptId: string };
}): Promise<boolean> {
  const receipt = await readOwnedPromptReceipt(input);

  return (
    receipt !== undefined &&
    hashWithDomain(SYSTEM_PROMPT_RECEIPT_DOMAIN, receipt.system_prompt) ===
      receipt.prompt_hash
  );
}

export async function defaultReceiptProvesTitle(input: {
  connection: Sql;
  run: OwnedRun & { proof: DigestExportProof; title: string };
}): Promise<boolean> {
  const { ownerId, chatId, proof, title } = input.run;

  const receipt = await readOwnedPromptReceipt({
    connection: input.connection,
    run: {
      ownerId,
      chatId,
      runId: proof.runId,
      attemptId: proof.attemptId,
    },
    promptHash: proof.promptHash,
  });

  return (
    receipt?.source === 'project_default' &&
    receipt.prompt_hash === proof.promptHash &&
    hashWithDomain(SYSTEM_PROMPT_RECEIPT_DOMAIN, receipt.system_prompt) ===
      proof.promptHash &&
    receipt.system_prompt.includes(sanitizeAuthoredText(title))
  );
}

const initializationEntry = z
  .object({
    chatId: z.string().uuid(),
    title: z.string().optional(),
  })
  .passthrough();

const initializationEvent = z
  .object({
    summaryAttemptId: z.string().uuid(),
    baselines: z
      .object({
        recencyDigestInitialization: z
          .object({
            baseline: z.unknown(),
            told: z.array(initializationEntry),
          })
          .passthrough(),
      })
      .passthrough(),
  })
  .passthrough();

function initializationMatchesIdentity(input: {
  payload: unknown;
  attemptId: string;
  legacyBaseline: unknown;
  chatId: string;
  title: string;
}): boolean {
  const parsed = initializationEvent.safeParse(input.payload);

  if (!parsed.success) return false;
  const initialization = parsed.data.baselines.recencyDigestInitialization;

  const matches = initialization.told.filter(
    (candidate) =>
      candidate.title !== undefined &&
      sanitizeAuthoredText(candidate.title.trim()) ===
        sanitizeAuthoredText(input.title.trim()),
  );

  return (
    parsed.data.summaryAttemptId === input.attemptId &&
    canonicalJson(initialization.baseline) ===
      canonicalJson(input.legacyBaseline) &&
    matches.length === 1 &&
    matches[0]?.chatId === input.chatId
  );
}

export async function immutableIdentityHasProof(input: {
  connection: Sql;
  ownerId: string;
  chatId: string;
  legacyBaseline: unknown;
  rebakedFrom: string | null;
  entry: DigestExportRecord['comparison']['entries'][number];
}): Promise<boolean> {
  const { connection, ownerId, chatId, legacyBaseline, entry } = input;

  const title = entry.title;

  if (
    !title ||
    input.rebakedFrom !== null ||
    !(await exportedValueHasPromptProof({
      connection,
      run: { ownerId, chatId, proof: entry.proofs.identity, value: title },
    }))
  )
    return false;

  const events = await connection<Array<{ payload: unknown }>>`
    select payload from run_events
    where run_id = ${entry.proofs.identity.runId}::uuid and event_type = 'run.suspended'
  `;

  const matches = events.some((event) =>
    initializationMatchesIdentity({
      payload: event.payload,
      attemptId: entry.proofs.identity.attemptId,
      legacyBaseline,
      chatId: entry.chatId,
      title,
    }),
  );

  if (!matches) return false;

  const [owned] = await connection<Array<{ id: string }>>`
    select id::text as id from chats where id = ${entry.chatId}::uuid and owner_user_id = ${ownerId}
  `;

  return owned !== undefined;
}

export const legacyToldEntry = z
  .object({
    chatId: z.string().uuid(),
    pinned: z.boolean(),
    title: z.string().optional(),
  })
  .passthrough();

const oldDigestNoticePayload = z
  .object({
    entries: z.array(
      z
        .object({
          title: z.string(),
          date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          messageCount: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
          pinned: z.boolean(),
          excerpt: z.string().optional(),
        })
        .strict()
        .superRefine((entry, context) => {
          if (entry.title.trim().length === 0)
            context.addIssue({
              code: 'custom',
              message: 'Invalid digest entry title',
            });
        }),
    ),
    pinChanges: z.array(
      z
        .object({ title: z.string().min(1), pinned: z.boolean() })
        .strict()
        .superRefine((change, context) => {
          if (change.title.trim().length === 0)
            context.addIssue({
              code: 'custom',
              message: 'Invalid digest pin title',
            });
        }),
    ),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.entries.length + value.pinChanges.length === 0)
      context.addIssue({ code: 'custom', message: 'Empty digest notice' });
  });

type PinChange = z.infer<typeof oldDigestNoticePayload>['pinChanges'][number];

type PinEvidence = Map<string, { messageId: string; pinned: boolean }>;

type LegacyNoticeMessage = { id: string; parts: unknown };

type NoticeProofInput = {
  connection: Sql;
  chat: { id: string; owner_user_id: string; recency_digest_told: unknown };
  record: DigestExportRecord;
  entry: DigestExportRecord['comparison']['entries'][number];
  cutoffSupported: boolean;
};

async function readLegacyPinItem(
  connection: Sql,
  ownerId: string,
  chatId: string,
  candidate: UnknownRecord,
): Promise<'ignore' | 'unproved' | 'snapshot' | ReadonlyArray<PinChange>> {
  if (
    !isRecord(candidate['data']) ||
    candidate['data']['producer'] !== 'recency-digest'
  )
    return 'ignore';

  if (!isContextItemPart(candidate) || !candidate.data.text?.trim())
    return 'unproved';

  const [authoredRun] = await connection<Array<{ id: string }>>`
    select id::text as id from runs
    where id = ${candidate.data.runId}::uuid and user_id = ${ownerId} and chat_id = ${chatId}::uuid
  `;

  if (!authoredRun) return 'unproved';

  if (
    candidate.data.form === 'snapshot' &&
    Object.keys(candidate.data.payload).length === 0
  )
    return 'snapshot';
  const payload = oldDigestNoticePayload.safeParse(candidate.data.payload);

  return candidate.data.form === 'notice' && payload.success
    ? payload.data.pinChanges
    : 'unproved';
}

async function latestDigestPinChanges(input: {
  connection: Sql;
  ownerId: string;
  chatId: string;
  messages: Array<LegacyNoticeMessage>;
}): Promise<PinEvidence | undefined> {
  const { connection, ownerId, chatId, messages } = input;
  let unproved = false;
  const latest: PinEvidence = new Map();

  for (const message of messages) {
    const parts = z.array(z.unknown()).safeParse(message.parts);

    if (!parts.success) return undefined;

    for (const candidate of parts.data) {
      if (!isRecord(candidate)) continue;

      const item = await readLegacyPinItem(
        connection,
        ownerId,
        chatId,
        candidate,
      );

      if (item === 'ignore') continue;

      if (item === 'snapshot' || item === 'unproved') {
        unproved = item === 'unproved';
        latest.clear();
        continue;
      }

      if (unproved) continue;

      for (const change of item)
        latest.set(sanitizeAuthoredText(change.title.trim()), {
          messageId: message.id,
          pinned: change.pinned,
        });
    }
  }

  return unproved ? undefined : latest;
}

async function loadNoticeMessages(
  input: NoticeProofInput,
): Promise<Array<LegacyNoticeMessage> | undefined> {
  const { connection, chat, record } = input;

  const [checkpoint] = await connection<
    Array<{ id: string; absorbedThroughSeq: string }>
  >`
    select id::text as id, absorbed_through_seq::text as "absorbedThroughSeq"
    from messages where chat_id = ${chat.id}::uuid and role = 'checkpoint'
    order by absorbed_through_seq desc limit 1
  `;

  if ((checkpoint?.id ?? null) !== record.provenance.activeCheckpointId)
    return undefined;
  const boundary = checkpoint?.absorbedThroughSeq ?? null;

  return connection<Array<LegacyNoticeMessage>>`
    select id::text as id, parts from messages
    where chat_id = ${chat.id}::uuid and seq <= ${record.provenance.lastOriginalSeq}
      and (${checkpoint?.id ?? null}::uuid is null or ${boundary}::bigint is null
        or id = ${checkpoint?.id ?? null}::uuid or seq > ${boundary}::bigint)
    order by seq
  `;
}

function currentTitleIsUnambiguous(input: NoticeProofInput): boolean {
  const told = z
    .array(legacyToldEntry)
    .safeParse(input.chat.recency_digest_told ?? []);

  return (
    told.success &&
    !told.data.some(
      (candidate) =>
        candidate.chatId !== input.entry.chatId &&
        candidate.title !== undefined &&
        sanitizeAuthoredText(candidate.title.trim()) ===
          sanitizeAuthoredText(input.entry.title.trim()),
    )
  );
}

export async function noticePinHasProof(
  input: NoticeProofInput,
): Promise<{ effectiveCorrection: boolean; proofMatches: boolean }> {
  const { connection, chat, record, entry, cutoffSupported } = input;

  if (!entry.title || !record.provenance.latestPreTurn || !cutoffSupported)
    return { effectiveCorrection: false, proofMatches: false };
  const messages = await loadNoticeMessages(input);

  if (messages === undefined)
    return { effectiveCorrection: true, proofMatches: false };

  const latest = await latestDigestPinChanges({
    connection,
    ownerId: chat.owner_user_id,
    chatId: chat.id,
    messages,
  });

  if (latest === undefined)
    return { effectiveCorrection: true, proofMatches: false };
  const correction = latest.get(sanitizeAuthoredText(entry.title.trim()));

  if (!correction) return { effectiveCorrection: false, proofMatches: false };

  return {
    effectiveCorrection: true,
    proofMatches:
      currentTitleIsUnambiguous(input) &&
      entry.proofs.pin.kind === 'notice' &&
      correction.messageId === entry.proofs.pin.messageId &&
      correction.pinned === entry.pinned,
  };
}
