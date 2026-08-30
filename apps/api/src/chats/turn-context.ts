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
} from '../db/schema';
import { type InstanceConfigReader } from '../instance-config/instance-config.service';
import { type SystemPromptsService } from '../system-prompts/system-prompts.service';
import { type KnowledgeToolCandidateResolverPort } from '../knowledge/knowledge-tool-candidate-resolver';
import {
  resolveEffectiveContext,
  type EffectiveContextSnapshotInput,
} from '../runs/effective-context-resolver';
import { CompactionsRepository } from './chats-repository';
import { RunsRepository } from '../runs/runs-repository';
import { ModelContextSnapshotsRepository } from '../runs/model-context-snapshots.repository';
import { type MessagePart } from './context-builder';
import { type ResolvedMemorySettings } from '../memory/memory.service';
import {
  formatTemporalAnchor,
  resolveInstanceTimezone,
} from '../prompts/temporal-anchor';
import {
  createModelChangeItem,
  createRecencyDigestDeltaItem,
  createRecencyDigestSupersessionItem,
  createTemporalItem,
  createToolAvailabilityItem,
  deriveToolAvailabilityPayload,
} from './context-item-producers';
import { type RecencyDigestDelta } from './recency-digest.service';
import { type PersistUserMessageAndRunInput } from './chat-loop.service';

export type TurnContextDeps = {
  logger: Logger;
  systemPrompts: Pick<SystemPromptsService, 'render'>;
  instanceConfig: InstanceConfigReader;
  knowledgeCandidates: KnowledgeToolCandidateResolverPort;
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
  messageParts: MessagePart[];
};

export async function buildTurnContextAndParts(
  deps: TurnContextDeps,
  input: BuildTurnContextInput,
): Promise<BuildTurnContextResult> {
  const { tx, chat, turnInput, shareRecentChats, digestDelta } = input;

  // Read the latest compaction UNCONDITIONALLY — the temporal anchor derives
  // from it (falling back to chat.createdAt), and it must be available even
  // for a chat's very first run. The downstream disclosure-epoch and
  // digest-rebake logic reuses this same row.
  const latestCompaction = await new CompactionsRepository(
    tx,
  ).findLatestByChatId(turnInput.chatId, turnInput.userId);
  const instanceTimezone = resolveInstanceTimezone(deps.logger);
  const anchor = formatTemporalAnchor(
    latestCompaction?.createdAt ?? chat.createdAt,
    instanceTimezone,
  );

  const effectiveContext = await resolveTurnEffectiveContext(deps, {
    tx,
    chat,
    turnInput,
    anchor,
  });
  const epoch = await resolveDisclosureEpoch(
    tx,
    chat,
    turnInput,
    latestCompaction,
  );
  const contextParts = deriveTurnContextParts({
    chat,
    turnInput,
    shareRecentChats,
    digestDelta,
    instanceTimezone,
    effectiveContext,
    epoch,
  });

  return {
    effectiveContext,
    messageParts: [...contextParts, ...turnInput.message.parts],
  };
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
    anchor: string;
  },
): Promise<EffectiveContextSnapshotInput> {
  const { tx, chat, turnInput, anchor } = input;
  let systemPrompt: string;
  try {
    systemPrompt = deps.systemPrompts.render({
      model: turnInput.model,
      anchor,
      user: turnInput.user,
      chats: chat.recencyDigestBaseline ?? undefined,
    });
  } catch (error) {
    if (chat.recencyDigestBaseline === null) throw error;
    deps.logger.error('recency_digest_render_failed');
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
): MessagePart[] {
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
): MessagePart[] {
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
}): MessagePart[] {
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
    ...deriveDigestDisclosureParts(
      chat,
      shareRecentChats,
      digestDelta,
      epoch,
      runId,
    ),
    temporalPart,
  ];
}
