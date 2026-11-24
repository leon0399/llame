import { isRecord } from '@workspace/runtime-safety';
import { collectPinCorrectionsFromMessage } from './recency-digest-export-notices';

import type { Db } from '../db/tenant-db.service';
import { canonicalJson, hashWithDomain } from '../canonical-json';
import type { Chat, RecencyDigestBaseline, Run, RunEvent } from '../db/schema';
import type { SystemPromptReceipt } from '../db/schema/system-prompt-receipts';
import {
  MessagesRepository,
  type CheckpointMessage,
} from './messages-repository';
import { RunEventsRepository, RunsRepository } from '../runs/runs-repository';
import { quotaRequestFromEvents } from '../runs/quota-wake-projection';

import { SystemPromptReceiptsRepository } from '../runs/system-prompt-receipts.repository';
import {
  renderSystemPromptTemplate,
  type PromptWebSearchInput,
  type RenderedPrompt,
} from '../instance-config/prompt-loader';
import {
  formatTemporalAnchor,
  resolveInstanceTimezone,
} from '../prompts/temporal-anchor';
import type {
  PromptChatsScalarDisclosure,
  PromptUserInput,
  SystemModelCatalogEntry,
} from '../models/model-catalog';
import { baselineMatchesEpoch } from '../skills/skill-prompt-baseline';
import {
  compareProof,
  proveRenderedDigestFields,
  type DigestProof,
  SYSTEM_PROMPT_RECEIPT_DOMAIN,
  type ProvenDigestEntry,
  type RecencyDigestExportRecord,
} from './recency-digest-export-proof';

type RunIdentity = { runId: string; attemptId: string };

type ScalarField = PromptChatsScalarDisclosure;

type ScalarProofs = NonNullable<
  RecencyDigestExportRecord['baseline']['scalarProofs']
>;

type PinCorrection = { title: string; pinned: boolean };

type AttemptState = {
  proofCandidates: Array<ProvenDigestEntry>;
  emittedTitles: Set<string>;
  pinCorrections: Array<PinCorrection>;
  pinCorrectionUnproved: boolean;
  matchedRun: RunIdentity | null;
  latestPreTurn: { runId: string; seq: number } | null;
  anyReceipt: boolean;
  attemptNotDispatched: boolean;
  matchedReceipt: boolean;
  candidateUnavailable: boolean;
  baselinePublicationUnproved: boolean;
  baselinePublicationProved: boolean;
  provenScalars: Partial<Pick<RecencyDigestBaseline, ScalarField>>;
  scalarProofs: ScalarProofs;
};

export type ReconstructedDigestAttempts = AttemptState & {
  activeCheckpointId: string | null;
  lastOriginalSeq: number;
  runCount: number;
};

export type DigestReconstructionInput = {
  tx: Db;
  ownerId: string;
  chat: Chat;
  models: ReadonlyArray<SystemModelCatalogEntry>;
  user: PromptUserInput | undefined;
  webSearch: PromptWebSearchInput | undefined;
};

type ReconstructionInput = DigestReconstructionInput;

type RunContext = {
  input: ReconstructionInput;
  messages: MessagesRepository;
  receipts: SystemPromptReceiptsRepository;
  runEvents: RunEventsRepository;
  timezone: string;
  baselinePublishedAt: Date | null;
  state: AttemptState;
};

/** A run with the checkpoint that governed its triggering turn. */
type RunTurn = { run: Run; checkpoint: CheckpointMessage | undefined };

type PreparedPrompt = {
  model: SystemModelCatalogEntry;
  rendered: RenderedPrompt;
};

function createState(): AttemptState {
  return {
    proofCandidates: [],
    emittedTitles: new Set(),
    pinCorrections: [],
    pinCorrectionUnproved: false,
    matchedRun: null,
    latestPreTurn: null,
    anyReceipt: false,
    attemptNotDispatched: false,
    matchedReceipt: false,
    candidateUnavailable: false,
    baselinePublicationUnproved: false,
    baselinePublicationProved: false,
    provenScalars: {},
    scalarProofs: {},
  };
}

function updateMatchedRun(state: AttemptState, proof: DigestProof): void {
  const current = state.matchedRun;

  if (current && compareProof(proof, { ...current, promptHash: '' }) >= 0)
    return;
  state.matchedRun = { runId: proof.runId, attemptId: proof.attemptId };
}

function recordEntryProof(state: AttemptState, entry: ProvenDigestEntry): void {
  state.proofCandidates.push(entry);
  const title = entry.fields.title;

  if (title !== undefined) state.emittedTitles.add(title);

  for (const field of ['title', 'date', 'messageCount', 'excerpt'] as const) {
    const proof = entry.proofs[field];

    if (field in entry.fields && proof) updateMatchedRun(state, proof);
  }
}

function recordProvenEntries(
  state: AttemptState,
  entries: ReadonlyArray<ProvenDigestEntry>,
): void {
  for (const entry of entries) recordEntryProof(state, entry);
}

function copyProvenScalar(
  target: AttemptState['provenScalars'],
  baseline: RecencyDigestBaseline,
  field: ScalarField,
): void {
  switch (field) {
    case 'compiledOn':
      target.compiledOn = baseline.compiledOn;

      return;
    case 'pinnedShown':
      target.pinnedShown = baseline.pinnedShown;

      return;
    case 'pinnedTotal':
      target.pinnedTotal = baseline.pinnedTotal;

      return;
    case 'recentShown':
      target.recentShown = baseline.recentShown;

      return;
    case 'recentTotal':
      target.recentTotal = baseline.recentTotal;
  }
}

function recordScalarProof(
  state: AttemptState,
  baseline: RecencyDigestBaseline,
  disclosed: ReadonlyMap<ScalarField, string>,
  proof: DigestProof,
): void {
  for (const field of [
    'compiledOn',
    'pinnedShown',
    'pinnedTotal',
    'recentShown',
    'recentTotal',
  ] as const) {
    const renderedValue = disclosed.get(field);

    if (renderedValue === undefined) continue;

    if (renderedValue !== String(baseline[field])) continue;
    copyProvenScalar(state.provenScalars, baseline, field);
    const previous = state.scalarProofs[field];

    if (!previous || compareProof(proof, previous) < 0)
      state.scalarProofs[field] = proof;
    const scalarProof = state.scalarProofs[field];

    if (scalarProof) updateMatchedRun(state, scalarProof);
  }
}

function recordReceiptProof(
  state: AttemptState,
  baseline: RecencyDigestBaseline,
  rendered: RenderedPrompt,
  receipt: SystemPromptReceipt,
): void {
  const fieldDisclosure = rendered.chatsFieldDisclosure;
  const chatsDisclosure = rendered.chatsDisclosure;

  if (!fieldDisclosure || !chatsDisclosure) return;

  const proof = {
    runId: receipt.runId,
    attemptId: receipt.attemptId,
    promptHash: receipt.promptHash,
  };

  const proved = proveRenderedDigestFields({
    renderedText: rendered.text,
    expectedPromptHash: receipt.promptHash,
    receipt,
    chats: baseline,
    disclosure: chatsDisclosure,
    fields: fieldDisclosure,
  });

  if (proved.reason) return;
  state.matchedReceipt = true;
  recordProvenEntries(state, proved.pinned);
  recordProvenEntries(state, proved.recent);
  recordScalarProof(state, baseline, fieldDisclosure.scalars, proof);
}

async function dispatchedReceiptsForRun(
  context: RunContext,
  runId: string,
  baseline: RecencyDigestBaseline | null,
): Promise<Array<SystemPromptReceipt>> {
  const { input, receipts, state, runEvents } = context;
  const runReceipts = await receipts.findByOwnedRun(runId, input.ownerId);
  state.anyReceipt ||= runReceipts.length > 0;

  if (!baseline) return [];
  const events = await runEvents.listByRunId(runId, input.ownerId);
  const dispatched: Array<SystemPromptReceipt> = [];

  for (const receipt of runReceipts) {
    const request = events.find(
      (event) =>
        event.eventType === 'model.requested' &&
        isRecord(event.payload) &&
        event.payload['attemptId'] === receipt.attemptId,
    );

    if (!request) {
      state.attemptNotDispatched = true;
      continue;
    }

    const publishedAt = context.baselinePublishedAt;

    // An initial baseline (no marker) is proved only by the quota
    // initialization witness of this exact attempt. A re-baked baseline is
    // proved only by a dispatch strictly after its marker checkpoint; equal
    // timestamps cannot order the two.
    const published =
      input.chat.recencyDigestRebakedFrom === null
        ? hasInitializationWitness(events, receipt.attemptId, baseline)
        : publishedAt !== null &&
          request.createdAt.getTime() > publishedAt.getTime();

    if (!published) {
      state.baselinePublicationUnproved = true;
      continue;
    }

    state.baselinePublicationProved = true;
    dispatched.push(receipt);
  }

  return dispatched;
}

function hasInitializationWitness(
  events: ReadonlyArray<RunEvent>,
  attemptId: string,
  baseline: RecencyDigestBaseline,
): boolean {
  return events.some((event) => {
    if (event.eventType !== 'run.suspended') return false;
    const request = quotaRequestFromEvents([event]);
    const initialization = request?.baselines?.recencyDigestInitialization;

    return (
      request?.summaryAttemptId === attemptId &&
      initialization !== undefined &&
      canonicalJson(initialization.baseline) === canonicalJson(baseline)
    );
  });
}

function hasCurrentSkillBaseline(
  context: RunContext,
  model: SystemModelCatalogEntry,
  checkpoint: CheckpointMessage | undefined,
): boolean {
  const { chat } = context.input;

  return (
    !model.referencesSkills ||
    chat.skillCatalogBaseline === null ||
    baselineMatchesEpoch(
      chat.skillCatalogBaseline,
      chat.skillCatalogRebakedFrom,
      checkpoint?.id ?? null,
    )
  );
}

function renderPrompt(
  context: RunContext,
  turn: RunTurn,
  model: SystemModelCatalogEntry,
  baseline: RecencyDigestBaseline,
): RenderedPrompt | undefined {
  const { input } = context;
  const { run, checkpoint } = turn;

  if (run.turnToolAvailability === null) return undefined;

  try {
    const rendered = renderSystemPromptTemplate({
      template: model.systemPromptTemplate,
      model,
      anchor: formatTemporalAnchor(
        checkpoint?.createdAt ?? input.chat.createdAt,
        context.timezone,
      ),
      user: input.user,
      chats: baseline,
      ...(input.chat.skillCatalogBaseline !== null && {
        skills: input.chat.skillCatalogBaseline,
      }),
      webSearch: input.webSearch,
      admittedToolIds: run.turnToolAvailability
        .filter(({ state: availability }) => availability === 'available')
        .map(({ id }) => id),
      captureChatsFieldDisclosure: true,
    });

    if (!rendered.chatsFieldDisclosure) return undefined;

    return rendered;
  } catch {
    return undefined;
  }
}

function preparePrompt(
  context: RunContext,
  turn: RunTurn,
  baseline: RecencyDigestBaseline,
): PreparedPrompt | undefined {
  const { input, state } = context;

  const model = input.models.find(
    (candidate) => candidate.id === turn.run.modelId,
  );

  const rendered =
    model && hasCurrentSkillBaseline(context, model, turn.checkpoint)
      ? renderPrompt(context, turn, model, baseline)
      : undefined;

  if (!model || !rendered) {
    state.candidateUnavailable = true;

    return undefined;
  }

  return { model, rendered };
}

function receiptMatchesRender(
  receipt: SystemPromptReceipt,
  model: SystemModelCatalogEntry,
  rendered: RenderedPrompt,
): boolean {
  return (
    receipt.source === model.systemPromptSource &&
    receipt.systemPrompt === rendered.text &&
    receipt.promptHash ===
      hashWithDomain(SYSTEM_PROMPT_RECEIPT_DOMAIN, rendered.text)
  );
}

async function reconstructRun(context: RunContext, run: Run): Promise<void> {
  const { input, messages, state } = context;

  if (!run.messageId) return;

  const trigger = await messages.findById(
    input.chat.id,
    input.ownerId,
    run.messageId,
  );

  if (!trigger) return;

  // Resolve the checkpoint that governed this run's triggering turn.
  const checkpoint = await messages.findActiveCheckpoint(
    input.chat.id,
    input.ownerId,
    {
      beforeSeq: trigger.seq,
    },
  );

  if (!state.latestPreTurn || trigger.seq > state.latestPreTurn.seq)
    state.latestPreTurn = { runId: run.id, seq: trigger.seq };
  const baseline = input.chat.recencyDigestBaseline;
  const dispatched = await dispatchedReceiptsForRun(context, run.id, baseline);

  if (!baseline || dispatched.length === 0) return;
  const prepared = preparePrompt(context, { run, checkpoint }, baseline);

  if (!prepared) return;

  for (const receipt of dispatched) {
    if (receiptMatchesRender(receipt, prepared.model, prepared.rendered))
      recordReceiptProof(state, baseline, prepared.rendered, receipt);
  }
}

/** Publication time of a re-baked baseline: its owned marker checkpoint. */
async function rebakedBaselinePublishedAt(
  messages: MessagesRepository,
  input: ReconstructionInput,
): Promise<Date | null> {
  const marker = input.chat.recencyDigestRebakedFrom;

  if (marker === null) return null;
  const message = await messages.findById(input.chat.id, input.ownerId, marker);

  return message?.role === 'checkpoint' && message.absorbedThroughSeq !== null
    ? message.createdAt
    : null;
}

/** Where the destination stands and which literal notices remain selected. */
async function loadDestinationPosition(
  messages: MessagesRepository,
  input: ReconstructionInput,
  state: AttemptState,
): Promise<
  Pick<ReconstructedDigestAttempts, 'activeCheckpointId' | 'lastOriginalSeq'>
> {
  const destinationMessages = await messages.findByChatId(
    input.chat.id,
    input.ownerId,
  );

  const activeCheckpoint = await messages.findActiveCheckpoint(
    input.chat.id,
    input.ownerId,
    { beforeSeq: Number.MAX_SAFE_INTEGER },
  );

  const boundary = activeCheckpoint?.absorbedThroughSeq ?? null;

  const selected = destinationMessages.filter(
    (message) =>
      boundary === null ||
      message.id === activeCheckpoint?.id ||
      message.seq > boundary,
  );

  for (const message of selected)
    collectPinCorrectionsFromMessage(message, state);

  return {
    activeCheckpointId: activeCheckpoint?.id ?? null,
    lastOriginalSeq: destinationMessages.reduce(
      (maxSeq, message) => Math.max(maxSeq, message.seq),
      0,
    ),
  };
}

export async function reconstructDigestAttempts(
  input: DigestReconstructionInput,
): Promise<ReconstructedDigestAttempts> {
  const messages = new MessagesRepository(input.tx);

  const runs = await new RunsRepository(input.tx).findByChatId(
    input.chat.id,
    input.ownerId,
  );

  const baselinePublishedAt = await rebakedBaselinePublishedAt(messages, input);
  const state = createState();
  state.baselinePublicationUnproved =
    input.chat.recencyDigestBaseline !== null && baselinePublishedAt === null;

  const context: RunContext = {
    input,
    messages,
    receipts: new SystemPromptReceiptsRepository(input.tx),
    runEvents: new RunEventsRepository(input.tx),
    timezone: resolveInstanceTimezone(),
    baselinePublishedAt,
    state,
  };

  for (const run of runs) await reconstructRun(context, run);

  const destinationPosition = await loadDestinationPosition(
    messages,
    input,
    state,
  );

  return {
    ...state,
    // One proved dispatch establishes publication; a later unproved receipt
    // does not revoke it.
    baselinePublicationUnproved:
      state.baselinePublicationUnproved && !state.baselinePublicationProved,
    ...destinationPosition,
    runCount: runs.length,
  };
}
