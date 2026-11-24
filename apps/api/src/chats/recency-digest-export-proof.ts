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
import { type PinCorrection } from './recency-digest-export-notices';

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
    entries: Array<{
      chatId: string;
      pinned: boolean;
      title: string;
      proofs: {
        identity: DigestProof;
        pin:
          | { kind: 'baseline'; proof: DigestProof }
          | { kind: 'notice'; messageId: string };
      };
    }>;
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

type ComparisonEntry =
  RecencyDigestExportRecord['comparison']['entries'][number];

type ToldEntryMapping = {
  entries: Array<ComparisonEntry>;
  omissions: RecencyDigestExportRecord['comparison']['omissions'];
};

type ComparisonEvidence = {
  emittedTitles: ReadonlyArray<string>;
  identityTitleProofs: ReadonlyMap<
    string,
    { proof: DigestProof; told: ReadonlyArray<RecencyDigestToldEntry> }
  >;
  toldInventory: ReadonlyArray<RecencyDigestToldEntry>;
  baseline: RecencyDigestBaseline;
  baselineMembershipProofs: ReadonlyMap<string, DigestProof>;
  pinCorrections: ReadonlyArray<PinCorrection>;
  pinCorrectionUnproved: boolean;
};

type ResolvedTitleIdentity = {
  chatId: string;
  normalized: string;
  proof: DigestProof;
  baselinePinned: boolean;
};

function matchingBaselineLists(baseline: RecencyDigestBaseline, title: string) {
  const matches: Array<'pinned' | 'recent'> = [];

  for (const list of ['pinned', 'recent'] as const) {
    for (const entry of baseline[list] ?? []) {
      if (sanitizeAuthoredText(entry.title.trim()) === title)
        matches.push(list);
    }
  }

  return matches;
}

function immutableTitleIdentity(
  input: ComparisonEvidence,
  emittedTitle: string,
  omissions: ToldEntryMapping['omissions'],
): ResolvedTitleIdentity | undefined {
  const identity = input.identityTitleProofs.get(emittedTitle);
  const normalized = sanitizeAuthoredText(emittedTitle.trim());

  const matches = (identity?.told ?? []).filter(
    (entry) =>
      entry.title !== undefined &&
      sanitizeAuthoredText(entry.title.trim()) === normalized,
  );

  const lists = matchingBaselineLists(input.baseline, normalized);
  const [entry] = matches;
  const [list] = lists;

  if (
    !identity ||
    matches.length !== 1 ||
    lists.length !== 1 ||
    !entry ||
    !list
  ) {
    if (matches.length > 1 || lists.length > 1)
      omissions.push({ field: 'identity', reason: 'duplicate_title' });
    else if (entry)
      omissions.push({
        chatId: entry.chatId,
        field: 'identity',
        reason: 'unproved_told_id',
      });

    return undefined;
  }

  return {
    chatId: entry.chatId,
    normalized,
    proof: identity.proof,
    baselinePinned: list === 'pinned',
  };
}

function comparisonPin(
  input: ComparisonEvidence,
  identity: ResolvedTitleIdentity,
) {
  if (input.pinCorrectionUnproved) return undefined;

  const correction = input.pinCorrections.findLast(
    ({ title }) => sanitizeAuthoredText(title.trim()) === identity.normalized,
  );

  if (correction) {
    const ambiguous = input.toldInventory.some(
      (entry) =>
        entry.chatId !== identity.chatId &&
        entry.title !== undefined &&
        sanitizeAuthoredText(entry.title.trim()) === identity.normalized,
    );

    if (ambiguous) return undefined;

    return {
      pinned: correction.pinned,
      proof: { kind: 'notice' as const, messageId: correction.messageId },
    };
  }

  const proof = input.baselineMembershipProofs.get(identity.normalized);

  return proof
    ? {
        pinned: identity.baselinePinned,
        proof: { kind: 'baseline' as const, proof },
      }
    : undefined;
}

/** Immutable evidence grants authority; current told only vetoes ambiguous notices. */
export function mapEmittedTitlesToToldEntries(
  input: ComparisonEvidence,
): ToldEntryMapping {
  const entries: ToldEntryMapping['entries'] = [];
  const omissions: ToldEntryMapping['omissions'] = [];

  for (const title of new Set(input.emittedTitles)) {
    const identity = immutableTitleIdentity(input, title, omissions);

    if (!identity) continue;

    const pin = comparisonPin(input, identity);

    if (!pin) {
      omissions.push({
        chatId: identity.chatId,
        field: 'pin',
        reason: 'pin_unproved',
      });
      continue;
    }

    entries.push({
      chatId: identity.chatId,
      pinned: pin.pinned,
      title,
      proofs: { identity: identity.proof, pin: pin.proof },
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
