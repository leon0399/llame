// @vitest-environment jsdom

import { EventType, type AGUIEvent } from "@ag-ui/core";
import { act, renderHook, waitFor } from "@testing-library/react";
import { StrictMode, useEffect, useRef } from "react";
import { expect, it, vi } from "vitest";

import { useAgUiChat } from "./use-ag-ui-chat";

it("closes an unmounted chat stream without delivering callbacks to the departed view", async () => {
  let release = () => {};

  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });

  let signal: AbortSignal | undefined;
  const onFinish = vi.fn();
  const onError = vi.fn();

  const { result, unmount } = renderHook(() =>
    useAgUiChat({
      id: "chat-1",
      messages: [],
      generateId: () => "message-1",
      onFinish,
      onError,
      transport: {
        sendMessages: async (_request, abort) => {
          signal = abort;

          return (async function* (): AsyncGenerator<AGUIEvent> {
            yield {
              type: EventType.RUN_STARTED,
              threadId: "chat-1",
              runId: "run-1",
            };
            await hold;
          })();
        },
        reconnectToStream: () => Promise.resolve(null),
      },
    }),
  );

  let pending: Promise<void> | undefined;

  act(() => {
    pending = result.current.sendMessage({ text: "hello" });
  });
  await waitFor(() => expect(result.current.messages.at(-1)?.id).toBe("run-1"));
  unmount();
  await pending;
  release();

  expect(signal?.aborted).toBe(true);
  expect(onFinish).not.toHaveBeenCalled();
  expect(onError).not.toHaveBeenCalled();
});

it("keeps the initial reconnect alive through Strict Mode effect replay", async () => {
  let release = () => {};

  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });

  const onError = vi.fn();

  const { result, unmount } = renderHook(
    () => {
      const attached = useRef(false);

      const chat = useAgUiChat({
        id: "chat-1",
        messages: [],
        generateId: () => "message-1",
        onFinish: () => {},
        onError,
        transport: {
          sendMessages: () => Promise.reject(new Error("Unexpected send")),
          reconnectToStream: async () =>
            (async function* (): AsyncGenerator<AGUIEvent> {
              yield {
                type: EventType.RUN_STARTED,
                threadId: "chat-1",
                runId: "run-1",
              };
              yield {
                type: EventType.TEXT_MESSAGE_START,
                messageId: "reply",
                role: "assistant",
              };
              yield {
                type: EventType.TEXT_MESSAGE_CONTENT,
                messageId: "reply",
                delta: "Reconnected",
              };
              await hold;
              yield { type: EventType.TEXT_MESSAGE_END, messageId: "reply" };
              yield {
                type: EventType.RUN_FINISHED,
                threadId: "chat-1",
                runId: "run-1",
              };
            })(),
        },
      });

      const { resumeStream } = chat;

      useEffect(() => {
        if (attached.current) return;
        attached.current = true;
        void resumeStream();
      }, [resumeStream]);

      return chat;
    },
    { wrapper: StrictMode },
  );

  await waitFor(() => expect(result.current.status).toBe("streaming"));
  act(() => {
    release();
  });
  await waitFor(() =>
    expect(result.current.messages.at(-1)?.parts).toEqual([
      { type: "text", text: "Reconnected", state: "done" },
    ]),
  );
  expect(onError).not.toHaveBeenCalled();
  unmount();
});
