import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";

import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { ChatStatus, UIMessage } from "ai";

import { toast } from "@workspace/ui/components/sonner";

import { useChatContext } from "@/contexts/chat-context";
import { getApiErrorStatus } from "@/lib/api/errors";
import type {
  ChatDeliveryResponse,
  ChatLatestRunResponse,
  PermissionModeResponseValue,
} from "@/lib/api/generated/models";
import {
  changeDeliveryMode,
  deliveriesQueryOptions,
  deliveryFiles,
  deliveryText,
  firstPendingSteer,
  isAlreadyDelivered,
  isRunActive,
  sendDelivery,
  updateDeliveries,
  useChatDeliveries,
  withdrawDelivery,
  type ChangeableDeliveryMode,
  type DeliveryMode,
} from "@/lib/services/chat/deliveries";
import { cancelRun, runIdToCancel } from "@/lib/services/chat/runs";
import { useLatestRef } from "@/lib/hooks/use-latest-ref";
import { safeRandomUUID } from "@/lib/uuid";
import {
  attachmentFileParts,
  revokePreviews,
  type ComposerAttachments,
} from "./use-composer-attachments";
import type { RunHandoff } from "./use-run-handoff";

/** What an action on a pending item needs of its Chat. */
type DeliveryContext = {
  queryClient: QueryClient;
  chatId: string;
  /** Hands off to the segment that follows a delivered message. */
  begin: (messageId: string) => void;
  /** Marks a message that must never hand off. */
  skip: (messageId: string) => void;
};

/** The composer's draft: what a send takes and an edit fills. */
type DraftState = {
  input: string;
  setInput: Dispatch<SetStateAction<string>>;
  attachments: ComposerAttachments;
};

function dropItem(ctx: DeliveryContext, deliveryId: string) {
  updateDeliveries(ctx.queryClient, ctx.chatId, (current) =>
    current.filter((item) => item.id !== deliveryId),
  );
}

/** The outcome of a failed action on `item`: 409 means it was delivered, and
 *  404 that it is gone. Any other failure leaves the item pending on the
 *  server, so it stays and the list is read again. */
function settleFailure(
  ctx: DeliveryContext,
  item: ChatDeliveryResponse,
  error: unknown,
) {
  if (isAlreadyDelivered(error)) {
    dropItem(ctx, item.id);
    ctx.begin(item.id);
  } else if (getApiErrorStatus(error) === 404) {
    dropItem(ctx, item.id);
  } else {
    toast.error("Couldn't update that message. Try again.");
    void ctx.queryClient.invalidateQueries({
      queryKey: deliveriesQueryOptions(ctx.chatId).queryKey,
    });
  }
}

async function changeItem(
  ctx: DeliveryContext,
  item: ChatDeliveryResponse,
  mode: ChangeableDeliveryMode,
) {
  try {
    const next = await changeDeliveryMode(ctx.chatId, item.id, mode);
    if (next.state === "pending") {
      updateDeliveries(ctx.queryClient, ctx.chatId, (current) =>
        current.map((entry) => (entry.id === next.id ? next : entry)),
      );
      return;
    }
    // The Chat had no live Run: the change stored the message and started
    // one for it.
    dropItem(ctx, next.id);
    ctx.begin(next.id);
  } catch (error) {
    settleFailure(ctx, item, error);
  }
}

async function withdrawItem(ctx: DeliveryContext, item: ChatDeliveryResponse) {
  try {
    const withdrawn = await withdrawDelivery(ctx.chatId, item.id);
    ctx.skip(item.id);
    dropItem(ctx, item.id);
    return withdrawn;
  } catch (error) {
    settleFailure(ctx, item, error);
    return null;
  }
}

/** Withdraws `item` and puts its text and files in the composer, ahead of the
 *  owner's draft, which stays. */
async function editItem(
  ctx: DeliveryContext,
  draft: DraftState,
  item: ChatDeliveryResponse,
) {
  const withdrawn = await withdrawItem(ctx, item);
  if (withdrawn === null) return;
  const text = deliveryText(withdrawn);
  // The owner may have typed during the round trip: their draft stays.
  draft.setInput((current) =>
    current.trim() === "" ? text : `${text}\n\n${current}`,
  );
  await draft.attachments.restoreFiles(deliveryFiles(withdrawn));
}

type Selections = {
  modelId: string | undefined;
  effort: string | undefined;
  permissionMode: PermissionModeResponseValue;
};

/** The message the composer holds, or null when there is nothing to send. A
 *  new id for every send, so an edited item never reuses its own. */
function composedMessage(draft: DraftState) {
  const text = draft.input.trim();
  const files = attachmentFileParts(draft.attachments.items);
  if (text === "" && files.length === 0) return null;
  const textParts = text === "" ? [] : [{ type: "text" as const, text }];
  return { text, id: safeRandomUUID(), parts: [...textParts, ...files] };
}

/** Sends the composer's message in `mode`. The draft clears at once and comes
 *  back if the send fails. */
async function sendComposed(
  ctx: DeliveryContext,
  draft: DraftState,
  selections: Selections,
  mode: DeliveryMode,
) {
  const message = composedMessage(draft);
  if (message === null) return;
  const sent = draft.attachments.items;
  draft.setInput("");
  draft.attachments.clear();
  try {
    const result = await sendDelivery({
      chatId: ctx.chatId,
      delivery: mode,
      message,
      ...selections,
    });
    revokePreviews(sent);
    if (result.kind === "started") {
      // The Run ended first: the send stored the message and started a Run.
      ctx.begin(message.id);
      return;
    }
    // Whether the item still waits is the server's to say: a delivery can
    // have taken it before this response arrived.
    void ctx.queryClient.invalidateQueries({
      queryKey: deliveriesQueryOptions(ctx.chatId).queryKey,
    });
  } catch {
    // The owner may have typed during the send: their draft stays.
    draft.setInput((current) =>
      current.trim() === "" ? message.text : `${message.text}\n\n${current}`,
    );
    draft.attachments.restore(sent);
    toast.error("Couldn't send that message. Try again.");
  }
}

/** An item that leaves the list without the owner withdrawing it was
 *  delivered: as a steer of the live Run, or as the message of the Run it
 *  started. Either way history holds its message now. */
function useDeliveredItems(
  items: ReadonlyArray<ChatDeliveryResponse>,
  begin: (messageId: string) => void,
) {
  const seenIds = useRef<ReadonlyArray<string>>([]);
  useEffect(() => {
    const present = new Set(items.map((item) => item.id));
    for (const id of seenIds.current) {
      if (!present.has(id)) begin(id);
    }
    seenIds.current = items.map((item) => item.id);
  }, [items, begin]);
}

/** Whether the document holds an open popup, which Esc closes first. */
function popupIsOpen() {
  const popup = '[role="menu"], [role="dialog"], [role="alertdialog"]';
  return document.querySelector(`${popup}, [role="listbox"]`) !== null;
}

/** Runs `stop` on Esc while a Run is active, unless Esc belongs to a popup or
 *  an input method. */
function useEscapeToStop(runActive: boolean, stop: () => void) {
  const stopRef = useLatestRef(stop);
  useEffect(() => {
    if (!runActive) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (event.isComposing || popupIsOpen()) return;
      stopRef.current();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [runActive, stopRef]);
}

type StopInput = {
  items: ReadonlyArray<ChatDeliveryResponse>;
  status: ChatStatus;
  latestRun: ChatLatestRunResponse | null;
  messages: ReadonlyArray<Pick<UIMessage, "id" | "role">>;
  /** The plain Stop: cancel the Run through the stream's own id. */
  stop: () => void;
  interrupt: (item: ChatDeliveryResponse) => void;
};

/** Stop and Esc: the first pending steer becomes an interrupt; with none, the
 *  Run is cancelled. The draft in the composer is never touched. */
function stopOrInterrupt(input: StopInput) {
  const { items, status, latestRun, messages } = input;
  const steer = firstPendingSteer(items);
  if (steer !== undefined) return input.interrupt(steer);
  // Between two segments no stream message names the Run: the Chat's newest
  // Run does.
  const betweenSegments =
    runIdToCancel(messages) === null &&
    (status === "ready" || status === "error");
  if (!betweenSegments || latestRun === null) return input.stop();
  cancelRun(latestRun.id).catch(() =>
    toast.error("Couldn't stop the response. Try again."),
  );
}

type UseChatDeliveryArgs = DraftState & {
  chatId: string;
  /** The Chat is stored: only then does it have pending items to read. */
  exists: boolean;
  status: ChatStatus;
  latestRun: ChatLatestRunResponse | null;
  messages: ReadonlyArray<Pick<UIMessage, "id" | "role">>;
  modelReadyForSend: boolean;
  stop: () => void;
  handoff: Pick<RunHandoff, "begin" | "skip">;
};

/**
 * Sending, listing, and acting on the messages that wait for a live Run
 * (run-steering D11), and Stop and Esc over them. While a Run is active the
 * composer sends through `deliver` instead of the chat transport, so Enter
 * steers and the menu can interrupt or queue; pending items come from
 * `GET /deliveries` and live `chat.deliveries` updates.
 */
export function useChatDelivery(args: UseChatDeliveryArgs) {
  const { chatId, exists, status, latestRun, attachments } = args;
  const ctx = { queryClient: useQueryClient(), chatId, ...args.handoff };
  const { selectedModel, selectedEffort, getPermissionMode } = useChatContext();
  const items = useChatDeliveries(chatId, exists);
  const runActive = isRunActive({ status, latestRun });
  useDeliveredItems(items, ctx.begin);

  const interrupt = (item: ChatDeliveryResponse) =>
    void changeItem(ctx, item, "interrupt");
  const handleStop = () => stopOrInterrupt({ ...args, items, interrupt });
  useEscapeToStop(runActive, handleStop);

  const selections = {
    modelId: selectedModel,
    effort: selectedEffort,
    permissionMode: getPermissionMode(chatId),
  };
  const canSend = exists && args.modelReadyForSend && !attachments.sendBlocked;
  return {
    items,
    runActive,
    /** No live Run, so nothing delivers until the owner acts. */
    paused: !runActive && items.length > 0,
    deliver: (mode: DeliveryMode) =>
      canSend ? sendComposed(ctx, args, selections, mode) : undefined,
    handleStop,
    steerNow: (item: ChatDeliveryResponse) =>
      void changeItem(ctx, item, "steer"),
    interruptNow: interrupt,
    remove: (item: ChatDeliveryResponse) => void withdrawItem(ctx, item),
    edit: (item: ChatDeliveryResponse) => void editItem(ctx, args, item),
  };
}
