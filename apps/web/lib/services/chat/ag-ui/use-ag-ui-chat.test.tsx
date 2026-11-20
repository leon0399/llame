// @vitest-environment jsdom

import { EventType, type AGUIEvent } from "@ag-ui/core";
import { act, renderHook, waitFor } from "@testing-library/react";
import { StrictMode, useEffect, useRef } from "react";
import { expect, it, vi } from "vitest";

import { isInterruptedStream } from "../run-notifications";
import { useStreamInterruption, useStreamRepair } from "../stream-repair";
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

it("ignores an old engine's late completion after switching X to Y to X", async () => {
  let release: (events: AsyncIterable<AGUIEvent>) => void = () => {};
  const onFinish = vi.fn();
  const onError = vi.fn();

  const transport = {
    sendMessages: () =>
      new Promise<AsyncIterable<AGUIEvent>>((resolve) => {
        release = resolve;
      }),
    reconnectToStream: () => Promise.resolve(null),
  };

  const { result, rerender, unmount } = renderHook(
    ({ id }) =>
      useAgUiChat({
        id,
        messages: [],
        generateId: () => "message-1",
        onFinish,
        onError,
        transport,
      }),
    { initialProps: { id: "X" } },
  );

  let pending: Promise<void> | undefined;
  act(() => {
    pending = result.current.sendMessage({ text: "old X" });
  });
  rerender({ id: "Y" });
  rerender({ id: "X" });
  await act(async () => {
    release(
      (async function* (): AsyncGenerator<AGUIEvent> {
        yield { type: EventType.RUN_STARTED, threadId: "X", runId: "old-run" };
      })(),
    );
    await pending;
  });

  expect(onFinish).not.toHaveBeenCalled();
  expect(onError).not.toHaveBeenCalled();
  expect(result.current.messages).toEqual([]);
  unmount();
});

it("retries failed repair attaches to the existing five-attempt ceiling", async () => {
  vi.useFakeTimers();

  const reconnectToStream = vi.fn(() =>
    Promise.reject(new TypeError("Failed to fetch")),
  );

  const onError = vi.fn();

  const { unmount } = renderHook(() => {
    const { interruption, report } = useStreamInterruption();

    const chat = useAgUiChat({
      id: "chat-1",
      messages: [
        {
          id: "run-1",
          role: "assistant",
          parts: [{ type: "text", text: "Partial", state: "streaming" }],
        },
      ],
      generateId: () => "message-1",
      onFinish: (finish) => {
        if (isInterruptedStream(finish)) report("run-1");
      },
      onError,
      transport: {
        sendMessages: () => Promise.reject(new Error("Unexpected send")),
        reconnectToStream,
      },
    });

    useStreamRepair({
      attach: () => {
        void chat.resumeStream();
      },
      interruption,
      currentRunId: "run-1",
      healthy: chat.status === "streaming",
      onAttempt: () => {},
    });
    useEffect(() => {
      report("run-1");
    }, [report]);
  });

  try {
    for (let attempt = 0; attempt < 7; attempt += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });
    }

    expect(reconnectToStream).toHaveBeenCalledTimes(5);
    expect(onError).toHaveBeenCalledTimes(5);
  } finally {
    unmount();
    vi.useRealTimers();
  }
});
