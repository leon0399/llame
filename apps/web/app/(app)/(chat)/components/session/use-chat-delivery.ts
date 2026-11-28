import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";

import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { ChatStatus, UIMessage } from "ai";

import { toast } from "@workspace/ui/components/sonner";

import { useChatContext, type ComposerPicks } from "@/contexts/chat-context";
import { getApiErrorStatus } from "@/lib/api/errors";
import type {
  ChatDeliveryResponse,
  ChatLatestRunResponse,
  ChatModelSelectionResponse,
  PermissionModeResponseValue,
} from "@/lib/api/generated/models";
import {
  changeDeliveryMode,
  deliveriesQueryOptions,
  deliveryFiles,
  deliveryText,
  firstPendingSteer,
  isAlreadyDelivered,
  isCommandText,
  isCompactionLive,
  isRunActive,
  sendableText,
  sendDelivery,
  updateDeliveries,
  useChatDeliveries,
  withdrawDelivery,
  type ChangeableDeliveryMode,
  type DeliveryMode,
  type DeliverySendRequest,
  type DeliverySendResult,
} from "@/lib/services/chat/deliveries";
import { chatQueryKeys } from "@/lib/services/chat/queries";
import { invalidateRenamedChat } from "@/lib/services/chat/management";
import { cancelRun, runIdToCancel } from "@/lib/services/chat/runs";
import { useShortcut } from "@/lib/shortcuts/shortcuts-context";
import { safeRandomUUID } from "@/lib/uuid";
import { useComposerSelection } from "../composer/use-composer-selection";
import {
  attachmentFileParts,
  revokePreviews,
  type ComposerAttachments,
} from "../composer/use-composer-attachments";
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

type DeliveryNotice = {
  kind: "error" | "status";
  message: string;
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

/** The delivered `item` started a Run: wait for its message's stream. A
 *  `/compact` item starts a compaction Run, which has no message and no
 *  stream, so history is read again to show its row instead. */
function handOffDelivered(ctx: DeliveryContext, item: ChatDeliveryResponse) {
  if (item.command === "compact") {
    void ctx.queryClient.invalidateQueries({
      queryKey: chatQueryKeys.messages(ctx.chatId),
    });

    return;
  }

  ctx.begin(item.id);
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
    handOffDelivered(ctx, item);
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
    handOffDelivered(ctx, next);
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
 *  owner's draft, which stays. A slash item needs an empty composer: joined
 *  to a draft, one command would become the other's argument. */
async function editItem(
  ctx: DeliveryContext,
  draft: DraftState & { latestInput: () => string },
  item: ChatDeliveryResponse,
) {
  if (isCommandText(deliveryText(item)) && draft.input.trim() !== "") {
    toast.info("Clear the composer to edit this command.");

    return;
  }

  const withdrawn = await withdrawItem(ctx, item);

  if (withdrawn === null) return;
  const text = deliveryText(withdrawn);

  // The owner may have typed during the round trip: their draft stays. Slash
  // text goes after a plain draft, so the draft never becomes the command's
  // argument. Two slash texts cannot share the composer: the newer one stays
  // and the withdrawn one is shown so it can be copied back.
  if (isCommandText(text) && isCommandText(draft.latestInput())) {
    toast.info(`Kept your newer command. The withdrawn one was: ${text}`);

    return;
  }

  draft.setInput((latest) => {
    if (latest.trim() === "") return text;

    return isCommandText(text)
      ? `${latest}\n\n${text}`
      : `${text}\n\n${latest}`;
  });
  await draft.attachments.restoreFiles(deliveryFiles(withdrawn));
}

type Selections = {
  /** The composer's model id or role, as it reaches the request's `selector`. */
  selector: string | undefined;
  effort: string | undefined;
  permissionMode: PermissionModeResponseValue;
};

type ComposedMessage = {
  text: string;
  id: string;
  parts: UIMessage["parts"];
};

/** The message the composer holds, or null when there is nothing to send. A
 *  new id for every send, so an edited item never reuses its own. */
function composedMessage(draft: DraftState): ComposedMessage | null {
  const text = sendableText(draft.input);
  const files = attachmentFileParts(draft.attachments.items);

  if (text === "" && files.length === 0) return null;

  const textParts = text === "" ? [] : [{ type: "text" as const, text }];

  return { text, id: safeRandomUUID(), parts: [...textParts, ...files] };
}

/** Directly sends an existing Chat's message, optionally as a delivery during
 *  a live Run. Failures restore the draft. */
type SendComposedInput = {
  ctx: DeliveryContext;
  draft: DraftState;
  selections: Selections;
  /** The api accepted the send: the composer's picks are spent. */
  onAccepted: () => void;
  mode: DeliveryMode | undefined;
  setNotice: (notice: DeliveryNotice | null) => void;
};

async function sendComposed({
  ctx,
  draft,
  selections,
  onAccepted,
  mode,
  setNotice,
}: SendComposedInput) {
  const message = composedMessage(draft);

  if (message === null) return;

  const sent = draft.attachments.items;
  const commandText = isCommandText(message.text);

  const request: DeliverySendRequest = {
    chatId: ctx.chatId,
    message,
    ...selections,
    delivery: mode,
  };

  draft.setInput("");
  draft.attachments.clear();
  setNotice(null);

  try {
    const result = await sendDelivery(request);

    onAccepted();
    revokePreviews(sent);
    handleSendResult(ctx, message.id, result, setNotice);
  } catch (error) {
    restoreFailedSend({
      draft,
      message,
      sent,
      commandText,
      error,
      setNotice,
    });
  }
}

function handleSendResult(
  ctx: DeliveryContext,
  messageId: string,
  result: DeliverySendResult,
  setNotice: (notice: DeliveryNotice | null) => void,
) {
  if (result.kind === "started") {
    ctx.begin(messageId);

    return;
  }

  if (result.kind === "command" || result.kind === "success") {
    // A compaction Run shows its own row once history names it the latest
    // Run; any other result is confirmed beside the composer.
    if (result.kind === "success" || result.command === "rename") {
      setNotice({
        kind: "status",
        message:
          result.kind === "command"
            ? `Renamed to “${result.title}”`
            : "Command completed.",
      });
      invalidateRenamedChat(ctx.queryClient, ctx.chatId);
    }

    void ctx.queryClient.invalidateQueries({
      queryKey: chatQueryKeys.messages(ctx.chatId),
    });

    return;
  }

  // Whether the item still waits is the server's to say: a delivery can
  // have taken it before this response arrived.
  void ctx.queryClient.invalidateQueries({
    queryKey: deliveriesQueryOptions(ctx.chatId).queryKey,
  });
}

function restoreFailedSend(input: {
  draft: DraftState;
  message: ComposedMessage;
  sent: ComposerAttachments["items"];
  commandText: boolean;
  error: unknown;
  setNotice: (notice: DeliveryNotice | null) => void;
}) {
  const { draft, message, sent, commandText, error, setNotice } = input;

  // The owner may have typed during the send: their draft stays. Slash text
  // goes after it, so the draft never becomes a command's argument; under a
  // newer slash draft it is not restored, so it never becomes one either.
  draft.setInput((current) => {
    if (current.trim() === "") return message.text;

    if (!commandText) return `${message.text}\n\n${current}`;

    return isCommandText(current) ? current : `${current}\n\n${message.text}`;
  });
  draft.attachments.restore(sent);

  if (commandText) {
    setNotice({
      kind: "error",
      message: error instanceof Error ? error.message : "The command failed.",
    });
  } else {
    toast.error("Couldn't send that message. Try again.");
  }
}

/** An item that leaves the list without the owner withdrawing it was
 *  delivered: as a steer of the live Run, or as the message of the Run it
 *  started. Either way history holds its message now. A `/compact` item
 *  starts a compaction Run, which has no message and no stream to attach. */
function useDeliveredItems(
  items: ReadonlyArray<ChatDeliveryResponse>,
  begin: (messageId: string) => void,
) {
  const seen = useRef<ReadonlyArray<ChatDeliveryResponse>>([]);
  useEffect(() => {
    const present = new Set(items.map((item) => item.id));

    for (const item of seen.current) {
      if (!present.has(item.id) && item.command !== "compact") begin(item.id);
    }

    seen.current = items;
  }, [items, begin]);
}

/** Whether the document holds an open popup, which Esc closes first. */
function popupIsOpen() {
  const popup = '[role="menu"], [role="dialog"], [role="alertdialog"]';

  return document.querySelector(`${popup}, [role="listbox"]`) !== null;
}

/** Runs `stop` on Esc while a Run is active, unless Esc belongs to a popup
 *  (input-method composition is filtered by the shortcuts provider). */
function useEscapeToStop(runActive: boolean, stop: () => void) {
  useShortcut(
    "run.stop",
    () => {
      if (popupIsOpen()) return false;
      stop();
    },
    runActive,
  );
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

  if (latestRun?.status === "awaiting_quota") {
    cancelRun(latestRun.id).catch(() =>
      toast.error("Couldn't stop the response. Try again."),
    );

    return;
  }

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

type DeliveryComposer = {
  ctx: DeliveryContext;
  draft: DraftState;
  selections: Selections;
  accepted: ChatModelSelectionResponse | null;
  picks: ComposerPicks;
  canSend: boolean;
  accept: (
    selection: ChatModelSelectionResponse | null,
    picks: ComposerPicks,
  ) => void;
  setNotice: (notice: DeliveryNotice | null) => void;
};

/** The send action: a delivery of the composer's message, when it may send. */
function deliveryAction(args: DeliveryComposer) {
  return (mode?: DeliveryMode) => {
    if (!args.canSend) return;

    void sendComposed({
      ctx: args.ctx,
      draft: args.draft,
      selections: args.selections,
      onAccepted: () => args.accept(args.accepted, args.picks),
      mode,
      setNotice: args.setNotice,
    });
  };
}

/** The per-item actions: steer it now, drop it, or put it back in the draft. */
function deliveryItemActions(
  ctx: DeliveryContext,
  draft: DraftState & { latestInput: () => string },
) {
  return {
    steerNow: (item: ChatDeliveryResponse) =>
      void changeItem(ctx, item, "steer"),
    remove: (item: ChatDeliveryResponse) => void withdrawItem(ctx, item),
    edit: (item: ChatDeliveryResponse) => void editItem(ctx, draft, item),
  };
}

/** The Chat's pending items and the Run state they wait on. */
function useDeliveryState(
  chatId: string,
  exists: boolean,
  status: ChatStatus,
  latestRun: ChatLatestRunResponse | null,
) {
  // A draft's first message shows before the server has stored the Chat;
  // until the send is accepted there is nothing to list, only a 404.
  const items = useChatDeliveries(chatId, exists && status !== "submitted");
  const runActive = isRunActive({ status, latestRun });

  return {
    items,
    runActive,
    /** No live Run, so nothing delivers until the owner acts. */
    paused: !runActive && items.length > 0,
    /** Steer now and Interrupt now wait while a compaction Run is live. */
    hurryable: !isCompactionLive(latestRun),
  };
}

/** Interrupt wiring: a steer on `item`, and Stop/Esc for the Run itself. */
function useDeliveryStop(
  ctx: DeliveryContext,
  args: UseChatDeliveryArgs,
  items: ReadonlyArray<ChatDeliveryResponse>,
  runActive: boolean,
) {
  const interrupt = (item: ChatDeliveryResponse) =>
    void changeItem(ctx, item, "interrupt");

  const handleStop = () => stopOrInterrupt({ ...args, items, interrupt });
  useEscapeToStop(runActive, handleStop);

  return { interrupt, handleStop };
}

/** What this Chat's next delivery names, and what an accepted one stores. */
function useDeliverySelections(chatId: string) {
  const { getPermissionMode, picks } = useChatContext();
  const composer = useComposerSelection();

  return {
    selections: {
      selector: composer.send.selector,
      effort: composer.send.effort,
      permissionMode: getPermissionMode(chatId),
    },
    accepted: composer.accepted,
    picks,
  };
}

/**
 * The send path: the context item actions share, the notice an accepted send
 * raises, and the action a send or queue click runs.
 */
function useDeliverySend(args: UseChatDeliveryArgs) {
  const { chatId, exists, attachments } = args;
  const [notice, setNotice] = useState<DeliveryNotice | null>(null);
  const ctx = { queryClient: useQueryClient(), chatId, ...args.handoff };
  const { acceptSend } = useChatContext();
  const { selections, accepted, picks } = useDeliverySelections(chatId);
  const canSend = exists && args.modelReadyForSend && !attachments.sendBlocked;

  return {
    ctx,
    notice,
    deliver: deliveryAction({
      ctx,
      draft: args,
      selections,
      accepted,
      picks,
      canSend,
      accept: acceptSend,
      setNotice,
    }),
  };
}

/** Edit resolves after a round trip: it reads the composer as it is then. */
function useLatestInput(input: string): () => string {
  const ref = useRef(input);

  useEffect(() => {
    ref.current = input;
  }, [input]);

  return () => ref.current;
}

/**
 * Sends slash-prefixed text on an existing Chat through the direct message
 * path, idle or not. While a Run is active, other sends use it too so Enter
 * steers and the menu can interrupt or queue; pending items come from
 * `GET /deliveries` and live `chat.deliveries` updates.
 */
export function useChatDelivery(args: UseChatDeliveryArgs) {
  const { chatId, exists, status, latestRun } = args;
  const latestInput = useLatestInput(args.input);
  const { ctx, notice, deliver } = useDeliverySend(args);

  const { items, runActive, paused, hurryable } = useDeliveryState(
    chatId,
    exists,
    status,
    latestRun,
  );

  useDeliveredItems(items, ctx.begin);

  const { interrupt, handleStop } = useDeliveryStop(
    ctx,
    args,
    items,
    runActive,
  );

  return {
    items,
    runActive,
    paused,
    hurryable,
    exists,
    notice,
    deliver,
    handleStop,
    interruptNow: interrupt,
    ...deliveryItemActions(ctx, { ...args, latestInput }),
  };
}
