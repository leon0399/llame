/**
 * The one write of an admission's selection, for every Run creator. A send,
 * `/compact`, Regenerate, a delivery start, queue promotion, and a job notice
 * all resolve through `resolveSendSettings` and then store its `nextSelection`
 * the same way: the write happens only when the resolution asks for one, and
 * it happens inside the transaction that holds the Chat row. The write is
 * owner-scoped, like every other Chat write.
 *
 * An owner request stores the selection it resolved; a derived creator stores
 * exactly one thing, the removal of a hold its admission dropped
 * (`model-roles`: "Other Run creators do not write the owner's choice").
 */

import type { Chat, Run } from '../db/schema';
import type { Db } from '../db/tenant-db.service';
import type { FailureClass } from '../models/provider-failure/provider-failure';
import type {
  ModelSwitchOrigin,
  ModelSwitchedPayload,
} from '../runs/model-switch';
import { RunEventsRepository } from '../runs/runs-repository';
import { ChatsRepository } from './chats-repository';
import type { ChatModelSelection } from '../models/model-selection';
import type { ResolvedSendSettings } from '../models/models.service';

/** Store the selection an admission resolved, when it resolved a write. */
export async function storeSelectionUpdate(
  chats: Pick<ChatsRepository, 'setModelSelection'>,
  chat: { readonly id: string; readonly ownerUserId: string },
  resolved: Pick<ResolvedSendSettings, 'nextSelection'>,
): Promise<void> {
  if (resolved.nextSelection === undefined) return;

  await chats.setModelSelection(
    chat.id,
    chat.ownerUserId,
    resolved.nextSelection,
  );
}

/** The hold a switch writes; `revertAt` is already the instant it ends. */
export type SwitchHoldInput = {
  /** `runs.selection_revision` of the Run that switches, or null for none. */
  readonly runSelectionRevision: number | null;
  /** `runs.selector` of the Run that switches. */
  readonly runSelector: string;
  readonly modelId: string;
  readonly effort: string | null;
  readonly revertAt: Date;
};

/** Store the fallback hold only while the owner's selection is unchanged. */
export async function writeSwitchHold(
  chats: Pick<ChatsRepository, 'setModelSelection'>,
  chat: {
    readonly id: string;
    readonly ownerUserId: string;
    readonly modelSelection: ChatModelSelection | null;
  },
  input: SwitchHoldInput,
): Promise<void> {
  const selection = chat.modelSelection;

  if (
    selection === null ||
    selection.revision !== input.runSelectionRevision ||
    selection.selector !== input.runSelector
  ) {
    return;
  }

  await chats.setModelSelection(chat.id, chat.ownerUserId, {
    ...selection,
    hold: {
      selector: input.runSelector,
      modelId: input.modelId,
      effort: input.effort,
      revertAt: input.revertAt.toISOString(),
    },
  });
}

/** Write a model switch hold and its typed event together. */
export async function recordOwnerSwitch(
  tx: Db,
  input: {
    readonly chat: Chat;
    readonly run: Run;
    readonly eventRunId: string;
    readonly toModelId: string;
    readonly toEffort: string | null;
    readonly failureClass: FailureClass;
    readonly messageId: string;
    readonly revertAt: Date;
    readonly origin: ModelSwitchOrigin;
  },
): Promise<void> {
  await writeSwitchHold(new ChatsRepository(tx), input.chat, {
    runSelectionRevision: input.run.selectionRevision,
    runSelector: input.run.selector,
    modelId: input.toModelId,
    effort: input.toEffort,
    revertAt: input.revertAt,
  });

  await new RunEventsRepository(tx).append(input.eventRunId, 'model.switched', {
    fromModelId: input.run.modelId,
    fromEffort: input.run.effort,
    toModelId: input.toModelId,
    toEffort: input.toEffort,
    failureClass: input.failureClass,
    messageId: input.messageId,
    origin: input.origin,
  } satisfies ModelSwitchedPayload);
}
