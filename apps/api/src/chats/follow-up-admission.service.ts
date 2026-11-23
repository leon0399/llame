/**
 * Follow-up admission (turn-actions D1–D4): the service that turns a request
 * on an existing turn into a queued Run, with no HTTP route of its own.
 *
 * One transaction locks the Chat's row, checks that the turn is the latest
 * one, passes the chat send's single-flight admission, applies the Continue
 * check, and creates the Run with the parts its event log starts from. The
 * caller dispatches and streams the returned Run through
 * `ChatLoopService.finalizeAcceptedRun`, so a follow-up never runs as a plain
 * Run.
 */

import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import { assertNotArchived } from '../db/assert-not-archived';
import { type Chat, type Message, type Run } from '../db/schema';
import {
  TenantDbService,
  type Db,
  type TenantRunner,
} from '../db/tenant-db.service';
import {
  InstanceConfigService,
  type InstanceConfigReader,
} from '../instance-config/instance-config.service';
import {
  ModelsService,
  resolvePermissionMode,
  resolveSendSettings,
  type ModelSelectionValidator,
  type ResolvedSendSettings,
} from '../models/models.service';
import {
  RunDispatchService,
  type RunDispatcher,
} from '../runs/run-dispatch.service';
import { ChatsRepository, MessagesRepository } from './chats-repository';
import { clearActiveRunSlot } from './chat-admission';
import { type AcceptedRun } from './chat-loop.service';
import { toRunUserMessage } from './chat-message-parts';
import {
  continueDecision,
  continueFollowUp,
  isFollowUpRefusal,
  regenerateDecision,
  type ContinueDecision,
  type RegenerateDecision,
} from './follow-up-decisions';
import { type PermissionMode } from '../tools/permissions/permission-mode';
import {
  createRunForMessage,
  type CreateRunForMessageInput,
  type FollowUpRunInput,
} from './run-creation';

/**
 * A follow-up request as the caller sent it, before its checks. Continue takes
 * its selector and its effort from the Run it continues, so those fields are
 * only here to be refused.
 */
export type FollowUpRequestInput = {
  action?: string;
  selector?: string;
  effort?: string;
  /** Absent means `default`, as on a chat send. */
  permissionMode?: PermissionMode;
};

/**
 * A follow-up request whose shape and mode passed before any transaction
 * exists. Continue takes its selector and effort from the Run it continues;
 * Regenerate names its own, both optional — the resolver fills either from the
 * Chat's stored selection.
 */
type ValidatedFollowUp =
  | { readonly action: 'continue'; readonly permissionMode: PermissionMode }
  | {
      readonly action: 'regenerate';
      readonly selector: string | undefined;
      readonly effort: string | undefined;
      readonly permissionMode: PermissionMode;
    };

/**
 * What one admission transaction returns. A refusal is a VALUE, not a throw:
 * the transaction may already have expired a stuck Run, and design D1 keeps
 * that expiry even when the follow-up is then refused. The caller throws the
 * refusal after the commit, so the refusal itself still writes nothing.
 */
type AdmissionOutcome = AcceptedRun | { refusal: Error };

async function assertTurnNotCompacted(
  tx: Db,
  input: { chatId: string; userId: string; userSeq: number },
): Promise<void> {
  if (
    (await new MessagesRepository(tx).findCheckpointAbsorbing(
      input.chatId,
      input.userId,
      input.userSeq,
    )) !== undefined
  ) {
    throw new ConflictException(
      'A follow-up request cannot target a compacted turn',
    );
  }
}

/** The accepted outcome of a follow-up Run admission, as the caller reads it. */
function admittedOutcome(input: {
  request: { chatId: string; userId: string };
  userMessage: Message;
  run: Run;
  modelId: string;
}): AcceptedRun {
  return {
    runId: input.run.id,
    userMessage: toRunUserMessage(input.userMessage),
    chatId: input.request.chatId,
    userId: input.request.userId,
    modelId: input.modelId,
  };
}

/**
 * The Run row a Continue creates: it copies the source Run's selector and
 * selected effort, while its model and effort pass the chat-send checks again.
 */
function continueRunFields(input: {
  request: { chatId: string; userId: string };
  turn: { chat: Chat; userMessage: Message };
  decision: Extract<ContinueDecision, { latestRun: Run }>;
  followUp: FollowUpRunInput;
  permissionMode: PermissionMode;
}): CreateRunForMessageInput {
  const { request, turn, decision, followUp, permissionMode } = input;
  const { latestRun, effort } = decision;

  return {
    userId: request.userId,
    chatId: request.chatId,
    modelId: latestRun.modelId,
    selector: latestRun.selector,
    effort,
    selectedEffort: latestRun.selectedEffort ?? undefined,
    selectionRevision: turn.chat.modelSelection?.revision ?? null,
    permissionMode,
    targetRunId: randomUUID(),
    followUp,
  };
}

/**
 * The Run row a Regenerate creates: the resolved selection, the revision it
 * read, and the reply it replaces instead of continuing.
 */
function regenerateRunFields(input: {
  request: { chatId: string; userId: string };
  resolved: ResolvedSendSettings;
  selectionRevision: number | null;
  decision: Extract<RegenerateDecision, { latestRun: Run }>;
}): CreateRunForMessageInput {
  const { request, resolved, decision } = input;

  return {
    userId: request.userId,
    chatId: request.chatId,
    modelId: resolved.modelId,
    selector: resolved.selector,
    effort: resolved.effort,
    selectedEffort: resolved.effort,
    selectionRevision: input.selectionRevision,
    permissionMode: resolved.permissionMode,
    targetRunId: randomUUID(),
    followUp: {
      action: 'regenerate',
      sourceRunId: decision.latestRun.id,
      notice: decision.notice,
      replacesUsage: decision.replacesUsage,
    },
  };
}

@Injectable()
export class FollowUpAdmissionService {
  constructor(
    @Inject(TenantDbService)
    private readonly tenantDb: TenantRunner,
    @Inject(ModelsService)
    private readonly models: ModelSelectionValidator,
    @Inject(InstanceConfigService)
    private readonly instanceConfig: InstanceConfigReader,
    @Inject(RunDispatchService)
    private readonly dispatch: RunDispatcher,
  ) {}

  /**
   * Admit a follow-up Run on an existing turn. A refused request throws before
   * or inside the transaction without creating a Run.
   */
  async admitFollowUpRun(input: {
    chatId: string;
    userId: string;
    userMessageId: string;
    request: FollowUpRequestInput;
  }): Promise<AcceptedRun> {
    // A refused request costs no transaction and writes nothing.
    const validated = this.validateFollowUpRequest(input.request);

    const outcome = await this.tenantDb.runAs(
      input.userId,
      async (tx): Promise<AdmissionOutcome> => {
        const turn = await this.lockLatestTurn(
          new ChatsRepository(tx),
          new MessagesRepository(tx),
          input,
        );

        await assertTurnNotCompacted(tx, {
          chatId: input.chatId,
          userId: input.userId,
          userSeq: turn.userMessage.seq,
        });

        // A chat send's own single-flight admission: a live Run answers 409, and
        // a stuck Run is expired here so the action check reads its outcome.
        await clearActiveRunSlot({
          tx,
          chatId: input.chatId,
          userId: input.userId,
          dispatch: this.dispatch,
          instanceConfig: this.instanceConfig,
        });

        return validated.action === 'continue'
          ? this.continueRun(tx, input, turn, validated.permissionMode)
          : this.regenerateRun(tx, input, turn, validated);
      },
    );

    // The expiry committed above; the refusal is answered from here, after it.
    if ('refusal' in outcome) {
      throw outcome.refusal;
    }

    return outcome;
  }

  /**
   * The checks that need no stored state: the request's shape and the enabled
   * permission mode. A Continue names no selector and no effort, because it
   * takes both from the Run it continues and a silently ignored field would
   * lie. A Regenerate may name either; the selector, its model, and the effort
   * resolve inside the admission transaction, against the Chat's stored
   * selection, in the chat-send order.
   */
  private validateFollowUpRequest(
    request: FollowUpRequestInput,
  ): ValidatedFollowUp {
    if (request.action === 'continue') {
      if (request.selector !== undefined) {
        throw new BadRequestException(
          'A continue request does not name a selector',
        );
      }

      if (request.effort !== undefined) {
        throw new BadRequestException(
          'A continue request does not name an effort',
        );
      }

      return {
        action: 'continue',
        permissionMode: this.permissionMode(request),
      };
    }

    if (request.action !== 'regenerate') {
      throw new BadRequestException('action must be continue or regenerate');
    }

    return {
      action: 'regenerate',
      selector: request.selector,
      effort: request.effort,
      permissionMode: this.permissionMode(request),
    };
  }

  /** The mode the operator enabled; absent means `default`, as on a chat send. */
  private permissionMode(request: FollowUpRequestInput): PermissionMode {
    return resolvePermissionMode(
      request.permissionMode,
      this.instanceConfig.config.tools.permissionModes,
    );
  }

  /**
   * The owned Chat and its row lock, then the turn: a user message of this
   * Chat with no user message after it. Every refusal here happens before any
   * job state is read, so a foreign Chat reveals nothing about its queue. The
   * row the lock returns is the one admission reads the stored selection from.
   */
  private async lockLatestTurn(
    chatsRepo: ChatsRepository,
    messagesRepo: MessagesRepository,
    input: { chatId: string; userId: string; userMessageId: string },
  ): Promise<{ chat: Chat; userMessage: Message }> {
    const chat = await chatsRepo.findById(input.chatId, input.userId);

    if (!chat) {
      throw new NotFoundException(`Chat ${input.chatId} not found`);
    }

    // The row lock comes before the archive check (design D1): an archive that
    // commits after the lock is seen by the next request, not this one. The
    // lock writes nothing, so a refused request leaves the Chat untouched; the
    // admitted path bumps `updated_at` below, once the turn is accepted.
    const locked = await chatsRepo.lock(input.chatId, input.userId);

    if (!locked) {
      throw new NotFoundException(`Chat ${input.chatId} not found`);
    }

    assertNotArchived(locked);

    const { userMessage } = await messagesRepo.findTurnState(
      input.chatId,
      input.userId,
      input.userMessageId,
    );

    if (!userMessage) {
      throw new NotFoundException(`Message ${input.userMessageId} not found`);
    }

    if (
      await messagesRepo.hasLaterUserMessage(
        input.chatId,
        input.userId,
        userMessage.seq,
      )
    ) {
      throw new ConflictException(
        'A follow-up request applies to the latest user message only',
      );
    }

    return { chat: locked, userMessage };
  }

  /**
   * The Continue check and the Run it admits. The Run copies the source Run's
   * selector and selected effort, while its model and effort pass the
   * chat-send checks again, so an operator who removed that model is answered
   * before any write; a stored effort stays exactly as it was. Continue never
   * writes the owner's selection (design D3: "other Run creators").
   */
  private async continueRun(
    tx: Db,
    input: { chatId: string; userId: string },
    turn: { chat: Chat; userMessage: Message },
    permissionMode: PermissionMode,
  ): Promise<AdmissionOutcome> {
    const decision = await continueDecision(
      tx,
      input,
      turn.userMessage,
      this.models,
    );

    if ('refusal' in decision) {
      return decision;
    }

    // Accepted: the Chat is the turn's latest activity again.
    await new ChatsRepository(tx).touch(input.chatId, input.userId);

    return this.admitContinueRun(tx, {
      request: input,
      turn,
      decision,
      permissionMode,
    });
  }

  /** The Continue Run row, after the parts its event log starts from are read. */
  private async admitContinueRun(
    tx: Db,
    input: {
      request: { chatId: string; userId: string };
      turn: { chat: Chat; userMessage: Message };
      decision: Extract<ContinueDecision, { latestRun: Run }>;
      permissionMode: PermissionMode;
    },
  ): Promise<AcceptedRun> {
    const { request, turn, decision } = input;

    const followUp = await continueFollowUp(
      tx,
      request.userId,
      decision.latestRun.id,
      decision.source,
    );

    const { run } = await createRunForMessage(
      tx,
      continueRunFields({ ...input, followUp }),
      turn.userMessage,
    );

    return admittedOutcome({
      request,
      userMessage: turn.userMessage,
      run,
      modelId: decision.latestRun.modelId,
    });
  }

  /**
   * The Regenerate check and the Run it admits. The Run replaces the turn's
   * reply — also a `completed` one — from the history through the triggering
   * user message. The selector and the effort resolve inside this transaction,
   * after the Chat row lock and the stuck-Run expiry, and an owner request
   * writes the selection it resolved (design D3).
   */
  private async regenerateRun(
    tx: Db,
    input: { chatId: string; userId: string },
    turn: { chat: Chat; userMessage: Message },
    validated: Extract<ValidatedFollowUp, { action: 'regenerate' }>,
  ): Promise<AdmissionOutcome> {
    const decision = await regenerateDecision(tx, input, turn.userMessage);

    if ('refusal' in decision) {
      return decision;
    }

    // Accepted: the Chat is the turn's latest activity again.
    await new ChatsRepository(tx).touch(input.chatId, input.userId);

    const selection = this.resolveRegenerateSelection(turn.chat, validated);

    if ('refusal' in selection) {
      return selection;
    }

    return this.admitRegenerateRun(tx, {
      request: input,
      turn,
      decision,
      resolved: selection.resolved,
    });
  }

  /**
   * The owner selection a Regenerate request resolves. A refusal is a value,
   * because the stuck-Run expiry the decision already performed must commit.
   */
  private resolveRegenerateSelection(
    chat: Chat,
    validated: Extract<ValidatedFollowUp, { action: 'regenerate' }>,
  ): { resolved: ResolvedSendSettings } | { refusal: Error } {
    try {
      return {
        resolved: resolveSendSettings(
          this.models,
          this.instanceConfig.config.tools.permissionModes,
          {
            stored: chat.modelSelection ?? null,
            request: {
              selector: validated.selector,
              effort: validated.effort,
            },
            writer: 'owner',
            permissionMode: validated.permissionMode,
          },
        ),
      };
    } catch (error) {
      if (!isFollowUpRefusal(error)) throw error;

      return { refusal: error };
    }
  }

  /** The Regenerate Run row, after the owner's selection is written back. */
  private async admitRegenerateRun(
    tx: Db,
    input: {
      request: { chatId: string; userId: string };
      turn: { chat: Chat; userMessage: Message };
      decision: Extract<RegenerateDecision, { latestRun: Run }>;
      resolved: ResolvedSendSettings;
    },
  ): Promise<AcceptedRun> {
    const { request, turn, decision, resolved } = input;

    const selectionRevision = await this.storeRegenerateSelection(
      tx,
      request,
      turn.chat,
      resolved,
    );

    const { run } = await createRunForMessage(
      tx,
      regenerateRunFields({ request, resolved, selectionRevision, decision }),
      turn.userMessage,
    );

    return admittedOutcome({
      request,
      userMessage: turn.userMessage,
      run,
      modelId: resolved.modelId,
    });
  }

  /** Writes the selection an owner Regenerate resolved, returning its revision. */
  private async storeRegenerateSelection(
    tx: Db,
    request: { chatId: string; userId: string },
    chat: Chat,
    resolved: ResolvedSendSettings,
  ): Promise<number | null> {
    if (resolved.nextSelection !== undefined) {
      await new ChatsRepository(tx).setModelSelection(
        request.chatId,
        resolved.nextSelection,
      );
    }

    return (
      resolved.nextSelection?.revision ?? chat.modelSelection?.revision ?? null
    );
  }
}
