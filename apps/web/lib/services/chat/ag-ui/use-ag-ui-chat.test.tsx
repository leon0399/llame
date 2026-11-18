// @vitest-environment jsdom

import { EventType, type AGUIEvent } from "@ag-ui/core";
import { act, renderHook, waitFor } from "@testing-library/react";
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
