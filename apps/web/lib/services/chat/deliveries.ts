import {
  queryOptions,
  useQuery,
  type QueryClient,
} from "@tanstack/react-query";
import type { ChatStatus, FileUIPart, UIMessage } from "ai";
import { z } from "zod";

import {
  changeChatDelivery,
  listChatDeliveries,
  withdrawChatDelivery,
} from "../../api/generated/chats/chats";
import type {
  ChangeChatDeliveryDto,
  ChatLatestRunResponse,
  ChatDeliveriesResponse,
  ChatDeliveryResponse,
  PermissionModeResponseValue,
} from "../../api/generated/models";
import { getApiErrorStatus } from "../../api/errors";
import {
  authAwareFetch,
  createAuthenticatedBrowserFetch,
} from "../../api/fetch";
import { chatQueryKeys } from "./queries";
import { isTerminalRunStatus } from "./run-notifications";
import { prepareSendMessagesRequest } from "./transport";

/** The modes a send may name while a Run of the Chat is live. */
export type DeliveryMode = "steer" | "interrupt" | "queue";

/** The modes a pending item can change to. */
export type ChangeableDeliveryMode = "steer" | "interrupt";

export function deliveriesQueryOptions(chatId: string) {
  return queryOptions({
    queryKey: chatQueryKeys.deliveries(chatId),
    queryFn: ({ signal }) =>
      listChatDeliveries(
        chatId,
        { signal },
        createAuthenticatedBrowserFetch(globalThis.fetch),
      ),
  });
}

const NO_DELIVERIES: ReadonlyArray<ChatDeliveryResponse> = [];

/** The Chat's pending items, first to deliver first. Live `chat.deliveries`
 *  messages replace the cached list, so the query never polls. */
export function useChatDeliveries(chatId: string, enabled: boolean) {
  const query = useQuery({ ...deliveriesQueryOptions(chatId), enabled });
  return query.data?.items ?? NO_DELIVERIES;
}

/** Replaces the cached pending list, as a live `chat.deliveries` message or a
 *  settled action reports it. */
export function setDeliveries(
  queryClient: QueryClient,
  chatId: string,
  items: ChatDeliveriesResponse["items"],
): void {
  queryClient.setQueryData<ChatDeliveriesResponse>(
    chatQueryKeys.deliveries(chatId),
    { items },
  );
}

/** Applies `change` to the cached pending list; a Chat with no cached list
 *  starts from an empty one. */
export function updateDeliveries(
  queryClient: QueryClient,
  chatId: string,
  change: (
    items: ChatDeliveriesResponse["items"],
  ) => ChatDeliveriesResponse["items"],
): void {
  queryClient.setQueryData<ChatDeliveriesResponse>(
    chatQueryKeys.deliveries(chatId),
    (current) => ({ items: change(current?.items ?? []) }),
  );
}

export type DeliverySendRequest = {
  chatId: string;
  delivery: DeliveryMode;
  /** A new client message id for every send, so an edit never reuses one. */
  message: { id: string; parts: UIMessage["parts"] };
  modelId: string | undefined;
  effort: string | undefined;
  permissionMode: PermissionModeResponseValue;
};

/** `pending`: the Run was live and the item waits (202). `started`: the Run
 *  had ended, so the send stored the message and started a Run, and the
 *  answer is that Run's UI message stream, which this client does not read. */
export type DeliverySendResult =
  | { kind: "pending"; item: ChatDeliveryResponse }
  | { kind: "started" };

/**
 * A send with a `delivery` mode. It bypasses the `useChat` transport because
 * its answer while a Run is live is 202 JSON, not a stream. A success that is
 * not 202 means the Run ended before the send arrived: the body is released
 * and the caller attaches to the new Run through the resume path.
 */
export async function sendDelivery(
  request: DeliverySendRequest,
): Promise<DeliverySendResult> {
  const { api, body } = prepareSendMessagesRequest({
    chatId: request.chatId,
    messages: [request.message],
    modelId: request.modelId,
    effort: request.effort,
    permissionMode: request.permissionMode,
  });
  const response = await authAwareFetch(api, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...body, delivery: request.delivery }),
  });
  if (!response.ok) {
    throw new Error(await sendFailureText(response));
  }
  if (response.status !== 202) {
    await response.body?.cancel();
    return { kind: "started" };
  }
  // SAFETY: a 202 from this route is a `ChatDeliveryResponse`, as the OpenAPI
  // document says; the generated client skips this route (tag `streaming`).
  return {
    kind: "pending",
    item: (await response.json()) as ChatDeliveryResponse,
  };
}

async function sendFailureText(response: Response): Promise<string> {
  const text = await response.text();
  return text === "" ? `Send failed (${response.status})` : text;
}

/** Deletes a pending item; the answer carries the parts to edit. */
export function withdrawDelivery(
  chatId: string,
  deliveryId: string,
): Promise<ChatDeliveryResponse> {
  return withdrawChatDelivery(
    chatId,
    deliveryId,
    undefined,
    createAuthenticatedBrowserFetch(globalThis.fetch),
  );
}

/** Changes a pending item to `steer` or `interrupt`. */
export function changeDeliveryMode(
  chatId: string,
  deliveryId: string,
  mode: ChangeableDeliveryMode,
): Promise<ChatDeliveryResponse> {
  return changeChatDelivery(
    chatId,
    deliveryId,
    // SAFETY: the generated DTO lists only `steer` until the `interrupt`
    // admission layer regenerates the OpenAPI document; the route accepts
    // `interrupt` by contract (run-steering D11).
    { mode } as ChangeChatDeliveryDto,
    undefined,
    createAuthenticatedBrowserFetch(globalThis.fetch),
  );
}

/** An action on an item that was already delivered answers 409; the item is
 *  gone from the pending list and its message is in the transcript. */
export function isAlreadyDelivered(error: unknown): boolean {
  return getApiErrorStatus(error) === 409;
}

const textPartSchema = z.looseObject({
  type: z.literal("text"),
  text: z.string(),
});

const filePartSchema = z.looseObject({
  type: z.literal("file"),
  url: z.string(),
  mediaType: z.string(),
  filename: z.string().optional(),
});

/** The pending item's text: its text parts, joined. */
export function deliveryText(item: ChatDeliveryResponse): string {
  return item.parts
    .flatMap((part) => {
      const text = textPartSchema.safeParse(part);
      return text.success ? [text.data.text] : [];
    })
    .join("\n\n");
}

/** The pending item's file parts, in stored order. */
export function deliveryFiles(item: ChatDeliveryResponse): Array<FileUIPart> {
  return item.parts.flatMap((part) => {
    const file = filePartSchema.safeParse(part);
    if (!file.success) return [];
    const { url, mediaType, filename } = file.data;
    return [
      {
        type: "file" as const,
        url,
        mediaType,
        ...(filename !== undefined && { filename }),
      },
    ];
  });
}

/**
 * Whether a Run of the Chat is live: a stream is in flight, or the Chat's
 * newest Run has not ended. The second signal covers the instant between two
 * segments of a Run, when the stream of one has closed and the next is not
 * attached yet.
 */
export function isRunActive(input: {
  status: ChatStatus;
  latestRun: ChatLatestRunResponse | null;
}): boolean {
  const { status, latestRun } = input;
  if (status === "streaming" || status === "submitted") return true;
  return latestRun !== null && !isTerminalRunStatus(latestRun.status);
}

/** The first pending `steer` item: the one Stop and Esc interrupt. */
export function firstPendingSteer(
  items: ReadonlyArray<ChatDeliveryResponse>,
): ChatDeliveryResponse | undefined {
  return items.find((item) => item.mode === "steer");
}
