import type { Chat } from '../db/schema';
import type { ReconstructedDigestAttempts } from './recency-digest-export-attempts';
import {
  mapEmittedTitlesToToldEntries,
  mergeProvenDigestEntries,
  recencyDigestFingerprint,
  type LegacyColumns,
  type RecencyDigestExportRecord,
} from './recency-digest-export-proof';

type AttemptEvidence = ReconstructedDigestAttempts;

type BaselineEntry = RecencyDigestExportRecord['baseline']['entries'][number];

type BaselineOmission =
  RecencyDigestExportRecord['baseline']['omissions'][number];

function missingFieldReason(attempts: AttemptEvidence): string {
  if (attempts.baselinePublicationUnproved) return 'baseline_input_unproved';

  if (attempts.matchedReceipt) return 'emission_unproved';

  if (attempts.attemptNotDispatched) return 'attempt_not_dispatched';

  if (attempts.candidateUnavailable) return 'input_unavailable';

  if (attempts.anyReceipt) return 'receipt_mismatch';

  return 'no_receipt';
}

function missingProvenanceReason(attempts: AttemptEvidence): string {
  if (attempts.baselinePublicationUnproved) return 'baseline_input_unproved';

  if (attempts.attemptNotDispatched) return 'attempt_not_dispatched';

  if (attempts.candidateUnavailable) return 'input_unavailable';

  if (attempts.anyReceipt) return 'receipt_mismatch';

  if (attempts.runCount === 0) return 'no_run_provenance';

  return 'no_receipt';
}

function missingFields(
  list: 'pinned' | 'recent',
  index: number,
  proofEntry: BaselineEntry | undefined,
  reason: string,
): Array<BaselineOmission> {
  return (['title', 'date', 'messageCount', 'excerpt'] as const).flatMap(
    (field) =>
      proofEntry && field in proofEntry.fields
        ? []
        : [{ list, index, field, reason }],
  );
}

function collectBaselineOmissions(
  baseline: Chat['recencyDigestBaseline'],
  proofEntries: ReadonlyMap<string, BaselineEntry>,
  attempts: AttemptEvidence,
): Array<BaselineOmission> {
  if (!baseline) return [];
  const reason = missingFieldReason(attempts);

  return (['pinned', 'recent'] as const).flatMap((list) =>
    (baseline[list] ?? []).flatMap((_entry, index) =>
      missingFields(list, index, proofEntries.get(`${list}:${index}`), reason),
    ),
  );
}

function unprovedScalars(
  baseline: Chat['recencyDigestBaseline'],
  attempts: AttemptEvidence,
): Array<
  'compiledOn' | 'pinnedShown' | 'pinnedTotal' | 'recentShown' | 'recentTotal'
> {
  if (!baseline) return [];

  return (
    [
      'compiledOn',
      'pinnedShown',
      'pinnedTotal',
      'recentShown',
      'recentTotal',
    ] as const
  ).filter((field) => !(field in attempts.provenScalars));
}

function buildComparison(
  chat: Chat,
  attempts: AttemptEvidence,
): RecencyDigestExportRecord['comparison'] {
  const compared = mapEmittedTitlesToToldEntries({
    emittedTitles: [...attempts.emittedTitles],
    told: chat.recencyDigestTold ?? [],
    baselineEntries: mergeProvenDigestEntries(attempts.proofCandidates),
    pinCorrections: attempts.pinCorrections,
    pinCorrectionUnproved: attempts.pinCorrectionUnproved,
  });

  return {
    entries: compared.entries,
    omissions: [
      ...compared.omissions,
      ...(chat.recencyDigestTold ?? [])
        .filter(
          (entry) =>
            !compared.entries.some(
              (proved) => proved.chatId === entry.chatId,
            ) &&
            !compared.omissions.some(
              (omission) => omission.chatId === entry.chatId,
            ),
        )
        .map((entry) => ({
          chatId: entry.chatId,
          field: 'identity',
          reason: 'unproved_told_id',
        })),
    ],
  };
}

function collectRecordOmissions(
  baselinePresent: boolean,
  attempts: AttemptEvidence,
  scalarFields: ReadonlyArray<string>,
  comparisonHasOmissions: boolean,
): RecencyDigestExportRecord['omissions'] {
  const omissions: RecencyDigestExportRecord['omissions'] = [];

  const reason = attempts.matchedReceipt
    ? 'emission_unproved'
    : missingProvenanceReason(attempts);

  if (!baselinePresent)
    omissions.push({ scope: 'baseline', field: '*', reason: 'no_baseline' });

  if (!attempts.matchedRun) {
    omissions.push({
      scope: 'baseline',
      field: '*',
      reason,
    });
  }

  for (const field of scalarFields) {
    omissions.push({
      scope: 'baseline',
      field,
      reason,
    });
  }

  if (comparisonHasOmissions)
    omissions.push({
      scope: 'comparison',
      field: '*',
      reason: 'comparison_proof_unavailable',
    });

  if (baselinePresent)
    omissions.push({
      scope: 'tool_surface',
      field: '*',
      reason: 'tool_surface_proof_unavailable',
    });

  return omissions;
}

function createBaselineProjection(
  chat: Chat,
  attempts: AttemptEvidence,
): RecencyDigestExportRecord['baseline'] {
  const mergedEntries = mergeProvenDigestEntries(attempts.proofCandidates);

  const proofEntries = new Map(
    mergedEntries.map((entry) => [`${entry.list}:${entry.index}`, entry]),
  );

  return {
    ...attempts.provenScalars,
    ...(Object.keys(attempts.scalarProofs).length > 0 && {
      scalarProofs: attempts.scalarProofs,
    }),
    entries: mergedEntries,
    omissions: collectBaselineOmissions(
      chat.recencyDigestBaseline,
      proofEntries,
      attempts,
    ),
  };
}

export function buildRecencyDigestExportRecord(input: {
  ownerId: string;
  chat: Chat;
  attempts: AttemptEvidence;
}): RecencyDigestExportRecord {
  const { ownerId, chat, attempts } = input;

  const columns: LegacyColumns = {
    baseline: chat.recencyDigestBaseline,
    told: chat.recencyDigestTold,
    rebakedFrom: chat.recencyDigestRebakedFrom,
  };

  const baseline = createBaselineProjection(chat, attempts);
  const comparison = buildComparison(chat, attempts);
  const missingScalars = unprovedScalars(chat.recencyDigestBaseline, attempts);

  return {
    ownerUserId: ownerId,
    chatId: chat.id,
    fingerprint: recencyDigestFingerprint(columns),
    baseline,
    comparison,
    provenance: {
      originalRun: attempts.matchedRun?.runId ?? null,
      attemptId: attempts.matchedRun?.attemptId ?? null,
      activeCheckpointId: attempts.activeCheckpointId,
      latestPreTurn: attempts.latestPreTurn,
      lastOriginalSeq: attempts.lastOriginalSeq,
    },
    omissions: collectRecordOmissions(
      chat.recencyDigestBaseline !== null,
      attempts,
      missingScalars,
      comparison.omissions.length > 0,
    ),
  };
}
