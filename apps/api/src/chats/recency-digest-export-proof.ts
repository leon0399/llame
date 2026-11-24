import { sanitizeAuthoredText } from '../instance-config/authored-text';

import { canonicalJson, hashWithDomain } from '../canonical-json';
import type {
  RecencyDigestBaseline,
  RecencyDigestToldEntry,
} from '../db/schema';
import type { RunEventsRepository } from '../runs/runs-repository';
import type {
  PromptChatsDisclosure,
  PromptChatsFieldDisclosure,
  PromptChatsInput,
} from '../models/model-catalog';

export const RECENCY_DIGEST_EXPORT_VERSION = 1 as const;
export const RECENCY_DIGEST_EXPORT_DOMAIN = 'llame:recency-digest:export:v1';
export const SYSTEM_PROMPT_RECEIPT_DOMAIN = 'llame:model-context:prompt:v1';

export type LegacyColumns = {
  baseline: RecencyDigestBaseline | null;
  told: Array<RecencyDigestToldEntry> | null;
  rebakedFrom: string | null;
};

export type RecencyDigestExportRecord = {
  ownerUserId: string;
  chatId: string;
  fingerprint: string;
  baseline: {
    compiledOn?: string;
    pinnedShown?: number;
    pinnedTotal?: number;
    recentShown?: number;
    recentTotal?: number;
    scalarProofs?: Partial<
      Record<
        | 'compiledOn'
        | 'pinnedShown'
        | 'pinnedTotal'
        | 'recentShown'
        | 'recentTotal',
        { runId: string; attemptId: string; promptHash: string }
      >
    >;
    entries: Array<{
      list: 'pinned' | 'recent';
      index: number;
      fields: Partial<
        Pick<
          RecencyDigestBaseline['pinned'][number],
          'title' | 'date' | 'messageCount' | 'excerpt'
        >
      >;
      proofs: Partial<
        Record<
          'title' | 'date' | 'messageCount' | 'excerpt',
          { runId: string; attemptId: string; promptHash: string }
        >
      >;
    }>;
    omissions: Array<{
      list: 'pinned' | 'recent';
      index: number;
      field: string;
      reason: string;
    }>;
  };
  comparison: {
    entries: Array<{ chatId: string; pinned: boolean; title?: string }>;
    omissions: Array<{ chatId?: string; field: string; reason: string }>;
  };
  provenance: {
    originalRun: string | null;
    attemptId: string | null;
    activeCheckpointId: string | null;
    latestPreTurn: { runId: string; seq: number } | null;
    lastOriginalSeq: number;
  };
  omissions: Array<{ scope: string; field: string; reason: string }>;
};

export type RecencyDigestExportDocument = {
  version: typeof RECENCY_DIGEST_EXPORT_VERSION;
  exporter: 'recency-digest-export/1';
  exportedAt: string;
  records: Array<RecencyDigestExportRecord>;
};

export type DigestProof = {
  runId: string;
  attemptId: string;
  promptHash: string;
};

export type ProvenDigestEntry =
  RecencyDigestExportRecord['baseline']['entries'][number];

type RenderedDigestProofResult = {
  pinned: Array<ProvenDigestEntry>;
  recent: Array<ProvenDigestEntry>;
  reason?: string;
};

type RenderedDigestInput = {
  renderedText: string;
  expectedPromptHash: string;
  receipt?: DigestProof & { systemPrompt: string };
  chats: PromptChatsInput;
  disclosure: PromptChatsDisclosure;
  fields: PromptChatsFieldDisclosure;
};

export function recencyDigestFingerprint(columns: LegacyColumns): string {
  return hashWithDomain(
    RECENCY_DIGEST_EXPORT_DOMAIN,
    canonicalJson({
      baseline: columns.baseline,
      told: columns.told,
      rebakedFrom: columns.rebakedFrom,
    }),
  );
}

function proveRenderedEntry(
  input: RenderedDigestInput,
  fieldProof: DigestProof,
  list: 'pinned' | 'recent',
  index: number,
): ProvenDigestEntry | undefined {
  const entry = input.chats[list]?.[index];
  const emitted = input.fields[list].get(index);

  if (!entry || !emitted || !input.disclosure[list].has(index))
    return undefined;
  const fields: ProvenDigestEntry['fields'] = {};
  const proofs: ProvenDigestEntry['proofs'] = {};

  for (const field of ['title', 'date', 'messageCount', 'excerpt'] as const) {
    if (!emitted.has(field)) continue;
    const value = emitted.get(field);

    if (field === 'messageCount') {
      if (value !== String(entry.messageCount)) continue;
      fields.messageCount = entry.messageCount;
    } else if (field === 'title') {
      fields.title = value;
    } else if (field === 'date') {
      fields.date = value;
    } else {
      fields.excerpt = value;
    }

    proofs[field] = fieldProof;
  }

  if (Object.keys(fields).length === 0) return undefined;

  return { list, index, fields, proofs };
}

function collectRenderedList(
  input: RenderedDigestInput,
  fieldProof: DigestProof,
  list: 'pinned' | 'recent',
): Array<ProvenDigestEntry> {
  return (input.chats[list] ?? []).flatMap((_entry, index) => {
    const proof = proveRenderedEntry(input, fieldProof, list, index);

    return proof ? [proof] : [];
  });
}

/** Only a byte-identical system receipt authorizes fields from this actual render. */
export function proveRenderedDigestFields(
  input: RenderedDigestInput,
): RenderedDigestProofResult {
  const { receipt } = input;

  const renderHash = hashWithDomain(
    SYSTEM_PROMPT_RECEIPT_DOMAIN,
    input.renderedText,
  );

  if (
    !receipt ||
    receipt.systemPrompt !== input.renderedText ||
    receipt.promptHash !== renderHash ||
    receipt.promptHash !== input.expectedPromptHash
  ) {
    return {
      pinned: [],
      recent: [],
      reason: receipt ? 'receipt_mismatch' : 'no_receipt',
    };
  }

  const proof: DigestProof = {
    runId: receipt.runId,
    attemptId: receipt.attemptId,
    promptHash: receipt.promptHash,
  };

  return {
    pinned: collectRenderedList(input, proof, 'pinned'),
    recent: collectRenderedList(input, proof, 'recent'),
  };
}

/** A receipt authorizes disclosure only when its exact attempt was dispatched. */
export async function hasDispatchedModelRequest(input: {
  events: Pick<RunEventsRepository, 'listByRunId'>;
  runId: string;
  ownerId: string;
  attemptId: string;
}): Promise<boolean> {
  const events = await input.events.listByRunId(input.runId, input.ownerId, {
    eventTypes: ['model.requested'],
    attemptId: input.attemptId,
    limit: 1,
  });

  return events.length > 0;
}

type PinCorrection = { title: string; pinned: boolean };

type ToldEntryMapping = {
  entries: Array<{ chatId: string; pinned: boolean; title: string }>;
  omissions: Array<{ chatId?: string; field: string; reason: string }>;
};

type TitledToldEntry = {
  chatId: string;
  title: string;
  normalized: string;
};

type UniqueTitleMapping = {
  matches: Array<TitledToldEntry>;
  omissions: ToldEntryMapping['omissions'];
};

/** Legacy told entries may lack a title; such an entry has no title identity. */
function titledToldEntry(
  entry: RecencyDigestToldEntry,
): Array<TitledToldEntry> {
  const { chatId, title } = entry;

  if (title === undefined) return [];
  const trimmed = title.trim();

  return trimmed.length > 0
    ? [{ chatId, title, normalized: sanitizeAuthoredText(trimmed) }]
    : [];
}

/** Identity proof uses only a unique emitted title in the destination's told state. */
function mapUniqueEmittedTitles(input: {
  emittedTitles: ReadonlyArray<string>;
  told: ReadonlyArray<RecencyDigestToldEntry>;
}): UniqueTitleMapping {
  const titled = input.told.flatMap(titledToldEntry);

  const matches: Array<TitledToldEntry> = [];
  const omissions: ToldEntryMapping['omissions'] = [];

  for (const emittedTitle of new Set(input.emittedTitles)) {
    const candidates = titled.filter(
      (candidate) => candidate.normalized === emittedTitle,
    );

    if (candidates.length !== 1) {
      if (candidates.length > 1)
        omissions.push({ field: 'identity', reason: 'duplicate_title' });
      continue;
    }

    const [toldEntry] = candidates;

    if (toldEntry) matches.push(toldEntry);
  }

  return { matches, omissions };
}

/** Pin proof is independent of the mutable told entry used for identity. */
function proveComparisonPin(input: {
  title: string;
  baselineEntries: ReadonlyArray<ProvenDigestEntry>;
  pinCorrections: ReadonlyArray<PinCorrection>;
  pinCorrectionUnproved: boolean;
}): boolean | undefined {
  if (input.pinCorrectionUnproved) return undefined;

  const normalized = sanitizeAuthoredText(input.title.trim());
  let baselinePin: boolean | undefined;
  let baselineMatches = 0;

  for (const entry of input.baselineEntries) {
    const title = entry.fields.title;

    if (
      title === undefined ||
      sanitizeAuthoredText(title.trim()) !== normalized
    ) {
      continue;
    }

    baselineMatches += 1;
    baselinePin = entry.list === 'pinned';
  }

  let correctionPin: boolean | undefined;

  for (const correction of input.pinCorrections) {
    if (sanitizeAuthoredText(correction.title.trim()) === normalized)
      correctionPin = correction.pinned;
  }

  if (correctionPin !== undefined) return correctionPin;

  return baselineMatches === 1 ? baselinePin : undefined;
}

/** Attribute unique emitted identities, then resolve each pin from independent proof. */
export function mapEmittedTitlesToToldEntries(input: {
  emittedTitles: ReadonlyArray<string>;
  told: ReadonlyArray<RecencyDigestToldEntry>;
  baselineEntries: ReadonlyArray<ProvenDigestEntry>;
  pinCorrections: ReadonlyArray<PinCorrection>;
  pinCorrectionUnproved: boolean;
}): ToldEntryMapping {
  const identities = mapUniqueEmittedTitles(input);

  const entries: ToldEntryMapping['entries'] = [];
  const omissions = [...identities.omissions];

  for (const toldEntry of identities.matches) {
    const pinned = proveComparisonPin({
      title: toldEntry.title,
      baselineEntries: input.baselineEntries,
      pinCorrections: input.pinCorrections,
      pinCorrectionUnproved: input.pinCorrectionUnproved,
    });

    if (pinned === undefined) {
      omissions.push({
        chatId: toldEntry.chatId,
        field: 'pin',
        reason: 'pin_unproved',
      });
      continue;
    }

    entries.push({
      chatId: toldEntry.chatId,
      pinned,
      title: toldEntry.title,
    });
  }

  return { entries, omissions };
}

export function compareProof(left: DigestProof, right: DigestProof): number {
  return (
    (left.runId < right.runId ? -1 : left.runId > right.runId ? 1 : 0) ||
    (left.attemptId < right.attemptId
      ? -1
      : left.attemptId > right.attemptId
        ? 1
        : 0) ||
    (left.promptHash < right.promptHash
      ? -1
      : left.promptHash > right.promptHash
        ? 1
        : 0)
  );
}

type DigestEntryField = 'title' | 'date' | 'messageCount' | 'excerpt';

function copyProvenEntryField(
  target: ProvenDigestEntry,
  source: ProvenDigestEntry,
  field: DigestEntryField,
): void {
  switch (field) {
    case 'title':
      target.fields.title = source.fields.title;
      target.proofs.title = source.proofs.title;

      return;
    case 'date':
      target.fields.date = source.fields.date;
      target.proofs.date = source.proofs.date;

      return;
    case 'messageCount':
      target.fields.messageCount = source.fields.messageCount;
      target.proofs.messageCount = source.proofs.messageCount;

      return;
    case 'excerpt':
      target.fields.excerpt = source.fields.excerpt;
      target.proofs.excerpt = source.proofs.excerpt;
  }
}

export function mergeProvenDigestEntries(
  candidates: ReadonlyArray<
    RecencyDigestExportRecord['baseline']['entries'][number]
  >,
): RecencyDigestExportRecord['baseline']['entries'] {
  const merged = new Map<string, ProvenDigestEntry>();

  for (const candidate of candidates) {
    const key = `${candidate.list}:${candidate.index}`;
    let entry = merged.get(key);

    if (!entry) {
      entry = {
        list: candidate.list,
        index: candidate.index,
        fields: {},
        proofs: {},
      };
      merged.set(key, entry);
    }

    for (const field of ['title', 'date', 'messageCount', 'excerpt'] as const) {
      if (!(field in candidate.fields)) continue;
      const proof = candidate.proofs[field];

      if (!proof) continue;
      const priorProof = entry.proofs[field];

      if (!priorProof || compareProof(proof, priorProof) < 0)
        copyProvenEntryField(entry, candidate, field);
    }
  }

  return [...merged.values()].sort((left, right) =>
    left.list === right.list
      ? left.index - right.index
      : left.list === 'pinned'
        ? -1
        : 1,
  );
}
