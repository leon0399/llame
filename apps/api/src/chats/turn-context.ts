/**
 * Turn context assembly for ChatLoopService's accepted-turn transaction
 * (chat-loop.service.ts#persistUserMessageAndRun): the effective context
 * (system prompt + tool catalog) this turn's Run snapshot binds, and the
 * context-rail items disclosing what changed since the previous Run. Split
 * out of ChatLoopService itself (a distinct responsibility, same reasoning
 * as context-builder.ts/context-item-producers.ts living apart from it) —
 * plain functions taking their few dependencies explicitly, not a second
 * injectable, so ChatLoopService's own constructor (and every direct
 * `new ChatLoopService(...)` test fixture across the codebase) is untouched.
 */
import { type Logger } from '@nestjs/common';

import { type Db } from '../db/tenant-db.service';
import {
  type Chat,
  type Compaction,
  type ModelContextSnapshot,
  type Run,
  type SkillCatalogBaseline,
} from '../db/schema';
import { type InstanceConfigReader } from '../instance-config/instance-config.service';
import { type SystemPromptsService } from '../system-prompts/system-prompts.service';
import { type KnowledgeToolCandidateResolverPort } from '../knowledge/knowledge-tool-candidate-resolver';
import {
  resolveEffectiveContext,
  type EffectiveContextSnapshotInput,
} from '../runs/effective-context-resolver';
import { ChatsRepository, CompactionsRepository } from './chats-repository';
import { RunsRepository } from '../runs/runs-repository';
import { ModelContextSnapshotsRepository } from '../runs/model-context-snapshots.repository';
import { type MessagePart } from './context-builder';
import {
  type MemorySettingsBindingResolver,
  type ResolvedMemorySettings,
} from '../memory/memory.service';
import {
  formatTemporalAnchor,
  resolveInstanceTimezone,
  type TemporalAnchor,
} from '../prompts/temporal-anchor';
import {
  createModelChangeItem,
  createRecencyDigestDeltaItem,
  createRecencyDigestSupersessionItem,
  createTemporalItem,
  createToolAvailabilityItem,
  deriveToolAvailabilityPayload,
} from './context-item-producers';
import {
  deriveRecencyDigestDelta,
  type RecencyDigestDelta,
} from './recency-digest.service';
import { type PersistUserMessageAndRunInput } from './chat-loop.service';

import {
  resolveTurnSkillState,
  type SkillCatalogNotice,
  type SkillTurnState,
} from './skill-turn-state';
import { type SkillCatalogPort } from '../skills/skill-catalog';

export type TurnContextDeps = {
  logger: Logger;
  systemPrompts: Pick<SystemPromptsService, 'render'>;
  instanceConfig: InstanceConfigReader;
  knowledgeCandidates: KnowledgeToolCandidateResolverPort;
  memory: MemorySettingsBindingResolver;
  /** Process-wide skill catalog; absent means no source is configured. */
  skillCatalog?: SkillCatalogPort;
};

type DisclosureEpoch = {
  previousRun: Run | undefined;
  previousSnapshot: ModelContextSnapshot | undefined;
  continuesDisclosureEpoch: boolean;
  digestRebaked: boolean;
};

export type BuildTurnContextInput = {
  tx: Db;
  chat: Chat;
  turnInput: PersistUserMessageAndRunInput;
  shareRecentChats: ResolvedMemorySettings;
  digestDelta: RecencyDigestDelta | null;
};

export type BuildTurnContextResult = {
  effectiveContext: EffectiveContextSnapshotInput;
  messageParts: Array<MessagePart>;
  /**
   * The catalog names this turn leaves the chat told about, when a notice
   * advanced that state. Undefined when nothing changed — either no notice was
   * due, or the model's template opts out, in which case the told state must
   * stay exactly where it was.
   */
  skillCatalogTold?: ReadonlyArray<string>;
};

type DigestBindingResult = {
  chat: Chat;
  shareRecentChats: ResolvedMemorySettings;
  digestDelta: RecencyDigestDelta | null;
};

export type TurnScope = { tx: Db; chatsRepo: ChatsRepository; chat: Chat };

export type ResolveTurnContextResult = BuildTurnContextResult & {
  digestDelta: RecencyDigestDelta | null;
};

/**
 * This turn's model-facing context: bind the recency-digest baseline/delta
 * first (resolveDigestBindingAndDelta below), then build the effective
 * context and context-rail parts from it — the two are tightly coupled,
 * `shareRecentChats`/`digestDelta` exist only to feed the second call.
 */
export async function resolveTurnContext(
  deps: TurnContextDeps,
  scope: TurnScope,
  input: PersistUserMessageAndRunInput,
): Promise<ResolveTurnContextResult> {
  const {
    chat: boundChat,
    shareRecentChats,
    digestDelta,
  } = await resolveDigestBindingAndDelta(deps, scope, input);
  const built = await buildTurnContextAndParts(deps, {
    tx: scope.tx,
    chat: boundChat,
    turnInput: input,
    shareRecentChats,
    digestDelta,
  });
  return { ...built, digestDelta };
}

/**
 * Bind this turn's recency-digest baseline (if the candidate resolved
 * earlier is still consented-to and the chat has none yet) and derive the
 * delta to disclose against the previously told set, if any.
 */
async function resolveDigestBindingAndDelta(
  deps: TurnContextDeps,
  scope: TurnScope,
  input: PersistUserMessageAndRunInput,
): Promise<DigestBindingResult> {
  const { tx, chatsRepo } = scope;
  let chat = scope.chat;
  const hadDigestBaseline = chat.recencyDigestBaseline !== null;
  // Read unconditionally: the supersession marker below is gated on this
  // setting too, and it must still be checkable when `input.digestCandidate`
  // is absent because this turn's own candidate resolution failed or was
  // skipped — that failure is unrelated to whether a *prior* compaction's
  // re-bake should be disclosed this turn.
  const shareRecentChats = await deps.memory.getForOwnerForBinding(
    tx,
    input.userId,
  );
  if (chat.recencyDigestBaseline == null && input.digestCandidate) {
    // FOR SHARE serializes a consent withdrawal with this accepted binding.
    // The candidate was intentionally read outside this transaction, so a
    // stale true must be discarded instead of entering an immutable prompt.
    if (shareRecentChats?.shareRecentChats === true) {
      const bound = await chatsRepo.setRecencyDigestIfAbsent(
        input.chatId,
        input.userId,
        input.digestCandidate.baseline,
        input.digestCandidate.told,
      );
      chat = bound ?? (await chatsRepo.findById(input.chatId, input.userId))!;
    }
  }

  const digestDelta =
    hadDigestBaseline &&
    input.digestCandidate &&
    chat.recencyDigestTold !== null &&
    shareRecentChats?.shareRecentChats === true
      ? deriveRecencyDigestDelta({
          candidate: input.digestCandidate,
          told: chat.recencyDigestTold,
          pinnedChatIds: await chatsRepo.findPinnedChatIds(
            input.userId,
            chat.recencyDigestTold.map(({ chatId }) => chatId),
          ),
        })
      : null;

  return { chat, shareRecentChats, digestDelta };
}

export async function buildTurnContextAndParts(
  deps: TurnContextDeps,
  input: BuildTurnContextInput,
): Promise<BuildTurnContextResult> {
  const { tx, chat, turnInput, shareRecentChats, digestDelta } = input;
  const instanceTimezone = resolveInstanceTimezone(deps.logger);
  const frozen = await resolveFrozenState(deps, {
    tx,
    chat,
    turnInput,
    instanceTimezone,
  });
  const { anchor, skillState } = frozen;

  const effectiveContext = await resolveTurnEffectiveContext(deps, {
    tx,
    chat,
    turnInput,
    anchor,
    skillBaseline: skillState.baseline,
  });
  const messageParts = await assembleTurnParts(deps, {
    tx,
    chat,
    frozen,
    effectiveContext,
    shareRecentChats,
    digestDelta,
    instanceTimezone,
    turnInput,
  });

  return {
    effectiveContext,
    messageParts,
    // Present only when a notice actually advanced the told state, so an
    // opted-out turn or an unchanged catalog leaves it exactly where it was.
    ...(skillState.notice !== undefined && {
      skillCatalogTold: skillState.notice.told,
    }),
  };
}

/**
 * This turn's rail items, ahead of the caller's own message parts.
 *
 * Split out so `buildTurnContextAndParts` stays a readable sequence — read the
 * frozen state, resolve the prompt and tool catalog, assemble the parts that
 * disclose what changed — rather than one long function.
 */
async function assembleTurnParts(
  deps: TurnContextDeps,
  input: {
    tx: Db;
    chat: Chat;
    frozen: Awaited<ReturnType<typeof resolveFrozenState>>;
    effectiveContext: EffectiveContextSnapshotInput;
    shareRecentChats: ResolvedMemorySettings;
    digestDelta: RecencyDigestDelta | null;
    instanceTimezone: string;
    turnInput: PersistUserMessageAndRunInput;
  },
): Promise<Array<MessagePart>> {
  const { frozen, effectiveContext, turnInput, chat } = input;
  const epoch = await resolveDisclosureEpoch(
    input.tx,
    chat,
    turnInput,
    frozen.latestCompaction,
  );
  return [
    ...deriveTurnContextParts({
      chat,
      turnInput,
      shareRecentChats: input.shareRecentChats,
      digestDelta: input.digestDelta,
      instanceTimezone: input.instanceTimezone,
      effectiveContext,
      epoch,
      skillNotice: frozen.skillState.notice,
    }),
    ...turnInput.message.parts,
  ];
}

/**
 * The per-chat frozen state one turn renders from.
 *
 * The latest compaction is read UNCONDITIONALLY — the temporal anchor derives
 * from it (falling back to `chat.createdAt`), so it must be available even for
 * a chat's very first run, and the disclosure-epoch logic reuses the same row.
 * The skill baseline resolves against that row because the compaction id IS the
 * epoch boundary it is stored under.
 */
async function resolveFrozenState(
  deps: TurnContextDeps,
  input: {
    tx: Db;
    chat: Chat;
    turnInput: PersistUserMessageAndRunInput;
    instanceTimezone: string;
  },
): Promise<{
  latestCompaction: Compaction | undefined;
  anchor: TemporalAnchor;
  skillState: SkillTurnState;
}> {
  const { tx, chat, turnInput, instanceTimezone } = input;
  const latestCompaction = await new CompactionsRepository(
    tx,
  ).findLatestByChatId(turnInput.chatId, turnInput.userId);
  return {
    latestCompaction,
    anchor: formatTemporalAnchor(
      latestCompaction?.createdAt ?? chat.createdAt,
      instanceTimezone,
    ),
    skillState: await resolveTurnSkillBaseline(deps, {
      tx,
      chat,
      turnInput,
      latestCompactionId: latestCompaction?.id ?? null,
    }),
  };
}

/**
 * This turn's frozen skill-catalog baseline (system-provided-skills D4).
 *
 * Reuse within an epoch is what keeps the rendered prompt byte-identical
 * between compactions, so the effective-context snapshot is reused rather than
 * re-minted; a new compaction therefore re-resolves lazily at the next accepted
 * turn, not inside the compaction path, which is what leaves an already-bound
 * Run's prompt untouched. A chat that has never been compacted pairs a baseline
 * with `null`, so its first resolution is reused until the first compaction.
 *
 * Nothing is written when no source is configured, so an instance without
 * skills carries no catalog state at all and renders no section.
 */
async function resolveTurnSkillBaseline(
  deps: TurnContextDeps,
  input: {
    tx: Db;
    chat: Chat;
    turnInput: PersistUserMessageAndRunInput;
    latestCompactionId: string | null;
  },
): Promise<SkillTurnState> {
  return resolveTurnSkillState(
    {
      skillCatalog: deps.skillCatalog,
      skillDirectories: deps.instanceConfig.config.skills.directories,
      // Operator-only: an unreadable catalog is logged, never shown to the
      // model. This is the same marker the prompt layer used before the skill
      // turn state moved here.
      reportUnavailable: (diagnostics) =>
        deps.logger.warn(`skill_catalog_unavailable: ${diagnostics.join(' ')}`),
    },
    {
      tx: input.tx,
      chat: input.chat,
      chatId: input.turnInput.chatId,
      ownerUserId: input.turnInput.userId,
      runId: input.turnInput.targetRunId,
      latestCompactionId: input.latestCompactionId,
      modelReferencesSkills: input.turnInput.model.referencesSkills,
    },
  );
}

/**
 * The system prompt (rendered from `anchor`) + resolved advertised/
 * executable tool catalog this turn's Run snapshot binds.
 */
async function resolveTurnEffectiveContext(
  deps: TurnContextDeps,
  input: {
    tx: Db;
    chat: Chat;
    turnInput: PersistUserMessageAndRunInput;
    anchor: TemporalAnchor;
    skillBaseline: SkillCatalogBaseline | undefined;
  },
): Promise<EffectiveContextSnapshotInput> {
  const { tx, chat, turnInput, anchor, skillBaseline } = input;
  let systemPrompt: string;
  try {
    systemPrompt = deps.systemPrompts.render({
      model: turnInput.model,
      anchor,
      user: turnInput.user,
      chats: chat.recencyDigestBaseline ?? undefined,
      // The frozen baseline, not a live read: the rendered prompt stays
      // byte-identical between compactions. Absent renders no catalog section.
      ...(skillBaseline !== undefined && { skills: skillBaseline }),
    });
  } catch (error) {
    if (chat.recencyDigestBaseline === null) throw error;
    deps.logger.error('recency_digest_render_failed');
    // The asymmetry above is the reason this error is deliberately bare: with
    // no digest bound the original is rethrown untouched, so this branch
    // exists ONLY to withhold detail once a recency digest IS bound. That
    // digest carries the owner's other chats' titles and opening excerpts,
    // which a render failure can embed in its message. Attaching `cause`
    // would reattach exactly what the branch suppresses, into an error that
    // leaves this process; the detail-free log marker is the same decision.
    // Preserving more means first deciding how much of a render failure may
    // travel without carrying prompt content.
    // eslint-disable-next-line preserve-caught-error -- see above
    throw new Error('Failed to render system prompt');
  }
  const codeOwnedCandidates = await deps.knowledgeCandidates.resolve({
    tx,
    ownerUserId: turnInput.userId,
    allowedToolRules: turnInput.allowedToolRules,
  });
  return resolveEffectiveContext({
    model: turnInput.model,
    systemPrompt,
    allowedToolRules: turnInput.allowedToolRules,
    callTimeoutSeconds: deps.instanceConfig.config.tools.callTimeoutSeconds,
    codeOwnedCandidates,
    dynamicCandidates: turnInput.dynamicCandidates,
  });
}

/**
 * Whether this turn starts a new disclosure epoch (no previous snapshot, or
 * a compaction landed since the previous Run — the availability reminder
 * then has no `previous` to diff against) or continues one, and whether the
 * digest was rebaked since the previous Run specifically (compaction is the
 * one context boundary that re-bakes it; a model switch changes only the
 * provider reading unchanged history).
 */
async function resolveDisclosureEpoch(
  tx: Db,
  chat: Chat,
  turnInput: PersistUserMessageAndRunInput,
  activeCompaction: Compaction | undefined,
): Promise<DisclosureEpoch> {
  const previousRun = await new RunsRepository(
    tx,
  ).findMostRecentByChatMessageSequence(turnInput.chatId, turnInput.userId);
  const previousSnapshot = previousRun
    ? await new ModelContextSnapshotsRepository(tx).findByOwnedRun(
        previousRun.id,
        turnInput.userId,
      )
    : undefined;

  const compactionSincePreviousRun =
    activeCompaction !== undefined &&
    previousRun !== undefined &&
    activeCompaction.createdAt > previousRun.createdAt;
  const startsDisclosureEpoch = !previousSnapshot || compactionSincePreviousRun;
  const digestRebaked =
    compactionSincePreviousRun &&
    chat.recencyDigestRebakedFrom === activeCompaction?.id;

  return {
    previousRun,
    previousSnapshot,
    continuesDisclosureEpoch: !startsDisclosureEpoch,
    digestRebaked,
  };
}

/**
 * The two context-rail items disclosing what changed in the tool/model
 * disclosure epoch since the previous Run: a model switch, and a tool
 * availability delta (no `previous` to diff against once a new epoch starts).
 */
function deriveEpochDisclosureParts(
  turnInput: PersistUserMessageAndRunInput,
  effectiveContext: EffectiveContextSnapshotInput,
  epoch: DisclosureEpoch,
): Array<MessagePart> {
  const { previousRun, previousSnapshot } = epoch;
  const runId = turnInput.targetRunId;

  const modelSwitchPart =
    previousRun && previousRun.modelId !== turnInput.modelId
      ? createModelChangeItem({
          fromModelId: previousRun.modelId,
          toModelId: turnInput.modelId,
          runId,
        })
      : undefined;
  const availabilityPayload = deriveToolAvailabilityPayload({
    current: effectiveContext.toolAvailabilityManifest,
    ...(epoch.continuesDisclosureEpoch && {
      previous: previousSnapshot?.toolAvailabilityManifest,
    }),
  });
  const availabilityPart = availabilityPayload
    ? createToolAvailabilityItem({ runId, payload: availabilityPayload })
    : undefined;

  return [
    ...(modelSwitchPart ? [modelSwitchPart] : []),
    ...(availabilityPart ? [availabilityPart] : []),
  ];
}

/**
 * The two context-rail items disclosing what changed in the recency digest
 * since the previous Run: a supersession notice (compaction rebaked it) and
 * an incremental delta against the previously told set.
 */
function deriveDigestDisclosureParts(
  input: {
    chat: Chat;
    shareRecentChats: ResolvedMemorySettings;
    digestDelta: RecencyDigestDelta | null;
    epoch: DisclosureEpoch;
  },
  runId: string,
): Array<MessagePart> {
  const { chat, shareRecentChats, digestDelta, epoch } = input;
  const digestSupersessionPart =
    epoch.digestRebaked &&
    chat.recencyDigestBaseline !== null &&
    shareRecentChats?.shareRecentChats === true
      ? createRecencyDigestSupersessionItem({ runId })
      : undefined;
  const digestDeltaPart = digestDelta
    ? createRecencyDigestDeltaItem({
        runId,
        payload: {
          entries: digestDelta.entries,
          pinChanges: digestDelta.pinChanges,
        },
      })
    : undefined;

  return [
    ...(digestSupersessionPart ? [digestSupersessionPart] : []),
    ...(digestDeltaPart ? [digestDeltaPart] : []),
  ];
}

/**
 * The context-rail items disclosing what changed since the previous Run
 * (tool availability, a model switch, a digest delta/supersession) plus the
 * always-present temporal anchor — everything this turn prepends ahead of
 * the caller's own message parts, in disclosure order.
 */
function deriveTurnContextParts(input: {
  chat: Chat;
  turnInput: PersistUserMessageAndRunInput;
  shareRecentChats: ResolvedMemorySettings;
  digestDelta: RecencyDigestDelta | null;
  instanceTimezone: string;
  effectiveContext: EffectiveContextSnapshotInput;
  epoch: DisclosureEpoch;
  skillNotice: SkillCatalogNotice | undefined;
}): Array<MessagePart> {
  const { chat, turnInput, shareRecentChats, digestDelta, epoch } = input;
  const runId = turnInput.targetRunId;

  // Stamped unconditionally, in the same zone the turn's anchor was resolved
  // in, so a turn's two temporal surfaces agree by construction. The instant
  // is captured here rather than read back from `created_at`: the renderer
  // receives the part alone, never the message that carries it.
  const temporalPart = createTemporalItem({
    runId,
    instant: new Date(),
    timeZone: input.instanceTimezone,
  });

  return [
    ...deriveEpochDisclosureParts(turnInput, input.effectiveContext, epoch),
    // Between tool availability and the catalog's activation items, which is
    // where the rail's producer precedence places it.
    ...(input.skillNotice ? [input.skillNotice.item] : []),
    ...deriveDigestDisclosureParts(
      { chat, shareRecentChats, digestDelta, epoch },
      runId,
    ),
    temporalPart,
  ];
}
