import type { AuthoredContextItemPart } from '../chats/context-item';
import type { Sql } from 'postgres';
import { z } from 'zod';
import { sanitizeAuthoredText } from '../instance-config/authored-text';
import {
  createRecencyDigestItem,
  type DigestAnnouncedEntry,
  type DigestAssociation,
} from '../chats/recency-digest-item';
import {
  digestColumnsFingerprint,
  type DigestExportRecord,
} from './recency-digest-export';
import {
  projectBaselineProofs,
  proofKey,
  renderBaselineBody,
} from './recency-digest-upgrade-baseline';
import {
  defaultReceiptProvesTitle,
  exportedValueHasPromptProof,
  immutableIdentityHasProof,
  legacyToldEntry,
  noticePinHasProof,
  originalRunHasPromptProof,
} from './recency-digest-upgrade-proofs';

export type LegacyChat = {
  id: string;
  owner_user_id: string;
  recency_digest_baseline: unknown;
  recency_digest_told: unknown;
  recency_digest_rebaked_from: string | null;
};

export type ImportOmission = {
  chatId: string;
  field: string;
  reason: string;
  relatedChatId?: string;
};

type ImportRequest = {
  connection: Sql;
  ownerId: string;
  chat: LegacyChat;
  record: DigestExportRecord | undefined;
  omissions: Array<ImportOmission>;
};

type BoundImport = ImportRequest & { record: DigestExportRecord };

type ComparisonEntry = DigestExportRecord['comparison']['entries'][number];

type ComparisonContext = BoundImport & {
  supported: ReadonlySet<string>;
  cutoffSupported: boolean;
};

type ImportedComparison = {
  baselineAnnounced: Array<DigestAnnouncedEntry>;
  noticeAnnounced: Array<DigestAnnouncedEntry>;
};

type ImportPosition = {
  cutoff: NonNullable<DigestExportRecord['provenance']['latestPreTurn']>;
  association: DigestAssociation;
};

type PreparedImport = ImportPosition & {
  runId: string;
  supported: ReadonlySet<string>;
  comparison: ImportedComparison;
};

export function recordOmission(
  omissions: Array<ImportOmission>,
  chatId: string,
  field: string,
  reason: string,
): void {
  omissions.push({ chatId, field, reason });
}

function validateImportBinding(input: ImportRequest): input is BoundImport {
  const { chat, record, ownerId, omissions } = input;

  if (!record) {
    recordOmission(omissions, chat.id, 'record', 'missing_export_record');

    return false;
  }

  if (record.chatId !== chat.id || record.ownerUserId !== ownerId) {
    recordOmission(omissions, chat.id, 'identity', 'misbound_export_record');

    return false;
  }

  const fingerprint = digestColumnsFingerprint({
    baseline: chat.recency_digest_baseline,
    told: chat.recency_digest_told,
    rebakedFrom: chat.recency_digest_rebaked_from,
  });

  if (fingerprint !== record.fingerprint) {
    recordOmission(omissions, chat.id, 'all', 'legacy_fingerprint_mismatch');

    return false;
  }

  return true;
}

function recordExportOmissions(input: BoundImport): void {
  const { chat, record, omissions } = input;

  for (const omission of record.omissions)
    recordOmission(omissions, chat.id, omission.field, omission.reason);

  for (const omission of record.baseline.omissions)
    recordOmission(omissions, chat.id, omission.field, omission.reason);

  for (const omission of record.comparison.omissions)
    recordOmission(omissions, chat.id, omission.field, omission.reason);

  const toldState = z
    .array(legacyToldEntry)
    .safeParse(chat.recency_digest_told ?? []);

  if (!toldState.success) {
    recordOmission(omissions, chat.id, 'identity', 'invalid_legacy_told_state');

    return;
  }

  for (const told of toldState.data) {
    if (
      !record.comparison.entries.some((entry) => entry.chatId === told.chatId)
    ) {
      omissions.push({
        chatId: chat.id,
        field: 'identity',
        reason: 'unproved_told_id',
        relatedChatId: told.chatId,
      });
    }
  }
}

async function collectSupportedBaselineFields(
  input: BoundImport,
): Promise<Set<string>> {
  const { connection, ownerId, chat, record, omissions } = input;

  const projection = projectBaselineProofs({
    record,
    legacyBaseline: chat.recency_digest_baseline,
  });

  const proofs = new Map(
    projection.values.map((item) => [
      proofKey(item.proof, item.field, item.value),
      item,
    ]),
  );

  for (const field of projection.mismatches)
    recordOmission(
      omissions,
      chat.id,
      'proof',
      `legacy_value_mismatch_${field}`,
    );
  const supported = new Set<string>();

  for (const [key, item] of proofs) {
    if (
      await exportedValueHasPromptProof({
        connection,
        run: { ownerId, chatId: chat.id, proof: item.proof, value: item.value },
      })
    )
      supported.add(key);
    else
      recordOmission(
        omissions,
        chat.id,
        'proof',
        `unsupported_${item.proof.runId}_${item.proof.attemptId}`,
      );
  }

  return supported;
}

async function baselinePinSupported(
  input: ComparisonContext,
  entry: ComparisonEntry,
): Promise<boolean> {
  const { connection, ownerId, chat, record, supported } = input;
  const title = entry.title;

  if (entry.proofs.pin.kind !== 'baseline' || !title) return false;

  const candidates = record.baseline.entries.filter(
    (candidate) =>
      candidate.fields.title !== undefined &&
      sanitizeAuthoredText(candidate.fields.title.trim()) ===
        sanitizeAuthoredText(title.trim()),
  );

  if (candidates.length !== 1) return false;
  const baseline = candidates[0];

  if (!baseline || (baseline.list === 'pinned') !== entry.pinned) return false;
  const titleProof = baseline.proofs.title;
  const baselineTitle = baseline.fields.title;

  if (
    !titleProof ||
    baselineTitle === undefined ||
    !supported.has(proofKey(titleProof, 'title', baselineTitle))
  )
    return false;

  return defaultReceiptProvesTitle({
    connection,
    run: { ownerId, chatId: chat.id, proof: entry.proofs.pin.proof, title },
  });
}

async function validateComparisonEntry(
  input: ComparisonContext,
  entry: ComparisonEntry,
): Promise<'baseline' | 'notice' | undefined> {
  const { chat, record, omissions } = input;

  if (
    !(await immutableIdentityHasProof({
      connection: input.connection,
      ownerId: input.ownerId,
      chatId: chat.id,
      legacyBaseline: chat.recency_digest_baseline,
      rebakedFrom: chat.recency_digest_rebaked_from,
      entry,
    }))
  ) {
    recordOmission(
      omissions,
      chat.id,
      'comparison.identity',
      'immutable_identity_proof_unavailable',
    );

    return undefined;
  }

  const notice = await noticePinHasProof({
    connection: input.connection,
    chat,
    record,
    entry,
    cutoffSupported: input.cutoffSupported,
  });

  if (notice.proofMatches) return 'notice';

  if (!notice.effectiveCorrection && (await baselinePinSupported(input, entry)))
    return 'baseline';
  recordOmission(
    omissions,
    chat.id,
    'comparison.pin',
    'effective_pin_proof_unavailable',
  );
}

async function validateComparisonEntries(
  input: ComparisonContext,
): Promise<ImportedComparison> {
  const baselineAnnounced: Array<DigestAnnouncedEntry> = [];
  const noticeAnnounced: Array<DigestAnnouncedEntry> = [];

  for (const entry of input.record.comparison.entries) {
    const kind = await validateComparisonEntry(input, entry);

    if (kind === undefined) continue;

    const announced = {
      chatId: entry.chatId,
      pinned: entry.pinned,
      title: entry.title,
    };

    noticeAnnounced.push(announced);

    if (kind === 'baseline') baselineAnnounced.push(announced);
  }

  return { baselineAnnounced, noticeAnnounced };
}

async function originalRunForImport(
  input: BoundImport,
): Promise<string | undefined> {
  const { connection, ownerId, chat, record, omissions } = input;
  const runId = record.provenance.originalRun;
  const attemptId = record.provenance.attemptId;

  if (
    runId &&
    attemptId &&
    (await originalRunHasPromptProof({
      connection,
      run: { ownerId, chatId: chat.id, runId, attemptId },
    }))
  )
    return runId;
  recordOmission(omissions, chat.id, 'baseline', 'original_run_unavailable');

  return undefined;
}

async function cutoffIsSupported(input: BoundImport): Promise<boolean> {
  const { connection, ownerId, chat, record } = input;
  const latest = record.provenance.latestPreTurn;

  if (!latest) return false;

  const [row] = await connection<Array<{ id: string; seq: string }>>`
    select run.id::text as id, trigger.seq::text as seq
    from runs run
    join messages trigger on trigger.id = run.message_id and trigger.chat_id = run.chat_id
    where run.user_id = ${ownerId} and run.chat_id = ${chat.id}::uuid and trigger.role = 'user'
    order by trigger.seq desc, run.created_at asc
    limit 1
  `;

  if (row?.id !== latest.runId || Number(row.seq) !== latest.seq) return false;

  const [last] = await connection<
    Array<{ seq: string }>
  >`select coalesce(max(seq), 0)::text as seq from messages where chat_id = ${chat.id}::uuid`;

  return Number(last?.seq) === record.provenance.lastOriginalSeq;
}

async function associationFor(
  input: BoundImport,
): Promise<DigestAssociation | undefined> {
  const { connection, chat, record } = input;

  const [checkpoint] = await connection<Array<{ id: string }>>`
    select id::text as id from messages
    where chat_id = ${chat.id}::uuid and role = 'checkpoint'
    order by absorbed_through_seq desc limit 1
  `;

  if ((checkpoint?.id ?? null) !== record.provenance.activeCheckpointId)
    return undefined;

  return checkpoint
    ? { kind: 'checkpoint', checkpointId: checkpoint.id }
    : { kind: 'origin', chatId: chat.id };
}

async function positionForImport(
  input: BoundImport,
  cutoffSupported: boolean,
): Promise<ImportPosition | undefined> {
  const { chat, record, omissions } = input;
  const cutoff = record.provenance.latestPreTurn;

  if (!cutoffSupported || !cutoff) {
    recordOmission(
      omissions,
      chat.id,
      'comparison',
      'logical_cutoff_unavailable',
    );

    return undefined;
  }

  const association = await associationFor(input);

  if (!association) {
    recordOmission(
      omissions,
      chat.id,
      'baseline',
      'baseline_association_unavailable',
    );

    return undefined;
  }

  return { cutoff, association };
}

async function prepareChatImport(
  input: BoundImport,
): Promise<PreparedImport | undefined> {
  const { chat, omissions } = input;
  const supported = await collectSupportedBaselineFields(input);
  const runId = await originalRunForImport(input);

  if (!runId) return undefined;
  const cutoffSupported = await cutoffIsSupported(input);

  const comparison = await validateComparisonEntries({
    ...input,
    supported,
    cutoffSupported,
  });

  if (supported.size === 0) {
    recordOmission(
      omissions,
      chat.id,
      'baseline',
      'no_independently_proved_fields',
    );

    return undefined;
  }

  const position = await positionForImport(input, cutoffSupported);

  return position ? { ...position, runId, supported, comparison } : undefined;
}

async function appendCarrier(
  connection: Sql,
  chatId: string,
  part: AuthoredContextItemPart,
): Promise<void> {
  const [row] = await connection<
    Array<{ seq: string }>
  >`select (coalesce(max(seq), 0) + 1)::text as seq from messages where chat_id = ${chatId}::uuid`;

  const sequence = Number(row?.seq);

  if (!Number.isSafeInteger(sequence) || sequence < 1)
    throw new Error('Digest carrier sequence is unavailable');
  await connection`
    insert into messages (chat_id, seq, role, sender_user_id, parts, attachments)
    values (${chatId}::uuid, ${sequence}, 'user', null, ${JSON.stringify([part])}::text::json, '[]'::jsonb)
  `;
}

async function publishImportedParts(
  input: BoundImport,
  prepared: PreparedImport,
): Promise<void> {
  const { connection, chat, record } = input;
  const { runId, association, cutoff, supported, comparison } = prepared;
  await appendCarrier(
    connection,
    chat.id,
    createRecencyDigestItem({
      runId,
      payload: {
        version: 1,
        kind: 'baseline',
        announced: comparison.baselineAnnounced,
        association,
      },
      body: renderBaselineBody(record, supported),
    }),
  );
  await appendCarrier(
    connection,
    chat.id,
    createRecencyDigestItem({
      runId,
      payload: {
        version: 1,
        kind: 'notice',
        announced: comparison.noticeAnnounced,
        association,
        importedCutoff: {
          latestTurnSeq: cutoff.seq,
          lastOriginalSeq: record.provenance.lastOriginalSeq,
        },
      },
      body: 'This historical Chat was converted to the current conversation format. No source Chat content is included in this notice.',
    }),
  );
}

export async function importChat(input: ImportRequest): Promise<boolean> {
  if (!validateImportBinding(input)) return false;
  recordExportOmissions(input);
  const prepared = await prepareChatImport(input);

  if (!prepared) return false;
  await publishImportedParts(input, prepared);

  return true;
}
