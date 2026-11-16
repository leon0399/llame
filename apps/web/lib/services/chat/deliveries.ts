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

/** The text a send carries: trimmed, except that whitespace before a `/`
 *  stays, so the API stores ` /rename Foo` as a message, not a command. */
export function sendableText(input: string): string {
  const text = input.trim();

  return text.startsWith("/") ? input.trimEnd() : text;
}

/** True when the composer text is a slash-command candidate: its first
 *  character is `/`. */
export function isCommandText(input: string): boolean {
  return input.startsWith("/");
}

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
  /** Only present when a Run is live. */
  delivery?: DeliveryMode;
  /** A new client message id for every send, so an edit never reuses one. */
  message: { id: string; parts: UIMessage["parts"] };
  modelId: string | undefined;
  effort: string | undefined;
  permissionMode: PermissionModeResponseValue;
};

/** `pending`: a live Run holds the item (202). `started`: the Run ended and
 *  the body is released before attaching through resume. `command`: the
 *  server handled the send without storing a message. */
export type DeliverySendResult =
  | { kind: "pending"; item: ChatDeliveryResponse }
  | { kind: "started" }
  | { kind: "success" }
  | { kind: "command"; command: "rename"; title: string }
  | { kind: "command"; command: "compact"; runId: string };

const commandResultSchema = z.discriminatedUnion("command", [
  z.object({
    type: z.literal("command"),
    command: z.literal("rename"),
    title: z.string(),
  }),
  z.object({
    type: z.literal("command"),
    command: z.literal("compact"),
    runId: z.string(),
  }),
]);

const sendFailureSchema = z
  .object({ message: z.union([z.string(), z.array(z.string())]) })
  .transform(({ message }) => ({
    message: Array.isArray(message) ? message.join("; ") : message,
  }));

/**
 * Directly sends an existing Chat's message. A live Run may answer with a
 * pending delivery; otherwise its stream is released before resume attaches.
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

  return interpretSendResponse(response);
}

async function interpretSendResponse(
  response: Response,
): Promise<DeliverySendResult> {
  if (!response.ok) {
    throw new Error(await sendFailureText(response));
  }

  if (response.status === 202) {
    // SAFETY: a 202 from this route is a `ChatDeliveryResponse`, as the OpenAPI
    // document says; the generated client skips this route (tag `streaming`).
    return {
      kind: "pending",
      item: (await response.json()) as ChatDeliveryResponse,
    };
  }

  if (
    response.status === 200 &&
    response.headers.get("content-type")?.includes("application/json")
  ) {
    const result: unknown = await response.json();
    const command = commandResultSchema.safeParse(result);

    if (!command.success) return { kind: "success" };
    const { data } = command;

    return data.command === "rename"
      ? { kind: "command", command: "rename", title: data.title }
      : { kind: "command", command: "compact", runId: data.runId };
  }

  await response.body?.cancel();

  return { kind: "started" };
}

async function sendFailureText(response: Response): Promise<string> {
  const text = await response.text();

  if (response.headers.get("content-type")?.includes("application/json")) {
    try {
      const body: unknown = JSON.parse(text);
      const parsed = sendFailureSchema.safeParse(body);

      if (parsed.success) return parsed.data.message;
    } catch {
      // A malformed error body falls back to its raw response text.
    }
  }

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
    { mode },
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

/** A compaction Run holds the Chat: owner items wait for it in the queue. */
export function isCompactionLive(
  latestRun: ChatLatestRunResponse | null,
): boolean {
  return (
    latestRun?.kind === "compaction" && !isTerminalRunStatus(latestRun.status)
  );
}

/** The first pending `steer` item: the one Stop and Esc interrupt. */
export function firstPendingSteer(
  items: ReadonlyArray<ChatDeliveryResponse>,
): ChatDeliveryResponse | undefined {
  return items.find((item) => item.mode === "steer");
}
