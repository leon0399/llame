import { EventType, type AGUIEvent } from "@ag-ui/core";
import type { UIMessage } from "ai";
import { describe, expect, it, vi } from "vitest";

import {
  AgUiChat,
  type ChatFinish,
  type ChatRequest,
  type ChatTransport,
} from "./chat";

const started = (runId: string): AGUIEvent => ({
  type: EventType.RUN_STARTED,
  threadId: "chat-1",
  runId,
});

const finished = (runId: string): AGUIEvent => ({
  type: EventType.RUN_FINISHED,
  threadId: "chat-1",
  runId,
});

const answer = (runId: string, delta: string): Array<AGUIEvent> => {
  const messageId = `${runId}:text-1`;

  return [
    { type: EventType.TEXT_MESSAGE_START, messageId, role: "assistant" },
    { type: EventType.TEXT_MESSAGE_CONTENT, messageId, delta },
    { type: EventType.TEXT_MESSAGE_END, messageId },
  ];
};

async function* eventsOf(events: Array<AGUIEvent>) {
  for (const event of events) {
    await Promise.resolve();
    yield event;
  }
}

const USER: UIMessage = {
  id: "user-1",
  role: "user",
  parts: [{ type: "text", text: "hi" }],
};

function chatWith(
  transport: Partial<ChatTransport>,
  messages: Array<UIMessage> = [],
) {
  const finishes: Array<ChatFinish> = [];
  const errors: Array<Error> = [];
  const requests: Array<ChatRequest> = [];

  const chat = new AgUiChat({
    id: "chat-1",
    messages,
    generateId: () => "generated-id",
    transport: {
      sendMessages: (request, signal) => {
        requests.push(request);

        if (transport.sendMessages === undefined) {
          throw new Error("unexpected send");
        }

        return transport.sendMessages(request, signal);
      },
      reconnectToStream:
        transport.reconnectToStream ?? (() => Promise.resolve(null)),
    },
    onFinish: (finish) => finishes.push(finish),
    onError: (error) => errors.push(error),
  });

  return { chat, finishes, errors, requests };
}

describe("AgUiChat", () => {
  it("rejects a second send before any render can disable the composer", async () => {
    const { chat, requests } = chatWith({
      sendMessages: () =>
        Promise.resolve(
          eventsOf([
            started("run-1"),
            ...answer("run-1", "first reply"),
            finished("run-1"),
          ]),
        ),
    });

    const first = chat.sendMessage({ text: "first" });

    await expect(chat.sendMessage({ text: "second" })).rejects.toThrow(
      "already in progress",
    );
    await first;

    expect(requests).toHaveLength(1);
    expect(chat.getSnapshot().messages).toMatchObject([
      { role: "user", parts: [{ text: "first" }] },
      { role: "assistant", parts: [{ text: "first reply" }] },
    ]);
  });

  it("does not announce a remotely cancelled Run as successful completion", async () => {
    const { chat, finishes, errors } = chatWith({
      sendMessages: () =>
        Promise.resolve(
          eventsOf([
            started("run-1"),
            ...answer("run-1", "partial"),
            {
              type: EventType.RUN_FINISHED,
              threadId: "chat-1",
              runId: "run-1",
              outcome: { type: "cancelled" },
            },
          ]),
        ),
    });

    await chat.sendMessage({ text: "hello" });

    expect(finishes[0]).toMatchObject({
      isAbort: true,
      isError: false,
      finishReason: undefined,
    });
    expect(chat.getSnapshot().messages.at(-1)?.parts).toEqual([
      { type: "text", text: "partial", state: "done" },
    ]);
    expect(errors).toEqual([]);
  });

  it("appends the owner's message, streams the reply under the Run id, and reports a finished turn", async () => {
    const { chat, finishes, requests } = chatWith({
      sendMessages: () =>
        Promise.resolve(
          eventsOf([
            started("run-1"),
            ...answer("run-1", "Hello"),
            finished("run-1"),
          ]),
        ),
    });

    await chat.sendMessage({ text: "hi" });

    const { messages, status } = chat.getSnapshot();
    expect(status).toBe("ready");
    expect(messages).toEqual([
      {
        id: "generated-id",
        role: "user",
        parts: [{ type: "text", text: "hi" }],
      },
      {
        id: "run-1",
        role: "assistant",
        parts: [{ type: "text", text: "Hello", state: "done" }],
      },
    ]);
    // The request carries the log including the message just appended.
    expect(requests[0]).toMatchObject({
      chatId: "chat-1",
      trigger: "submit-message",
      messages: [{ id: "generated-id" }],
    });
    expect(finishes).toEqual([
      expect.objectContaining({
        isAbort: false,
        isError: false,
        finishReason: "stop",
      }),
    ]);
  });

  it("puts attached files before the text, and sends no text part for a files-only message", async () => {
    const { chat } = chatWith({
      sendMessages: () => Promise.resolve(eventsOf([])),
    });

    const file = {
      type: "file" as const,
      mediaType: "image/png",
      url: "media://1",
    };

    await chat.sendMessage({ text: "look", files: [file] });
    await chat.sendMessage({ files: [file] });

    const [withText, filesOnly] = chat.getSnapshot().messages;
    expect(withText?.parts).toEqual([file, { type: "text", text: "look" }]);
    expect(filesOnly?.parts).toEqual([file]);
  });

  it("reports a dropped stream as a disconnect so history repair can run", async () => {
    const { chat, finishes, errors } = chatWith({
      sendMessages: () =>
        Promise.resolve(
          eventsOf([started("run-1"), ...answer("run-1", "par")]),
        ),
    });

    await chat.sendMessage({ text: "hi" });

    expect(chat.getSnapshot().status).toBe("error");
    expect(errors[0]?.message).toBe(
      "Network stream ended before the Run finished.",
    );
    expect(finishes[0]).toMatchObject({
      isAbort: false,
      isError: true,
      isDisconnect: true,
      finishReason: undefined,
    });
  });

  it("fails the request on the Run's own failure, keeping the parts it streamed", async () => {
    const { chat, finishes, errors } = chatWith({
      sendMessages: () =>
        Promise.resolve(
          eventsOf([
            started("run-1"),
            ...answer("run-1", "partial"),
            { type: EventType.RUN_ERROR, message: "Run failed." },
          ]),
        ),
    });

    await chat.sendMessage({ text: "hi" });

    const { messages, status, error } = chat.getSnapshot();
    expect(status).toBe("error");
    expect(error?.message).toBe("Run failed.");
    expect(errors.map((caught) => caught.message)).toEqual(["Run failed."]);
    expect(messages.at(-1)?.parts).toEqual([
      { type: "text", text: "partial", state: "done" },
    ]);
    expect(finishes[0]).toMatchObject({
      isError: true,
      isDisconnect: false,
      finishReason: undefined,
    });
  });

  it("reports a refused send through onError instead of rejecting, and a dropped fetch as a disconnect", async () => {
    const refused = chatWith({
      sendMessages: () =>
        Promise.reject(new Error('{"code":"permission_mode_not_available"}')),
    });

    await expect(refused.chat.sendMessage({ text: "hi" })).resolves.toBe(
      undefined,
    );
    expect(refused.errors[0]?.message).toContain(
      "permission_mode_not_available",
    );
    expect(refused.finishes[0]).toMatchObject({
      isError: true,
      isDisconnect: false,
    });

    const dropped = chatWith({
      sendMessages: () => Promise.reject(new TypeError("Failed to fetch")),
    });

    await dropped.chat.sendMessage({ text: "hi" });
    expect(dropped.finishes[0]).toMatchObject({
      isError: true,
      isDisconnect: true,
    });
  });

  it("ends a stopped request as an abort, even when the stream ignores the abort signal", async () => {
    const { chat, finishes, errors } = chatWith({
      // A response body that outlives its request: nothing more ever arrives.
      sendMessages: () =>
        Promise.resolve(
          (async function* () {
            yield started("run-1");
            await new Promise<never>(() => {});
          })(),
        ),
    });

    const sent = chat.sendMessage({ text: "hi" });
    await vi.waitFor(() =>
      expect(chat.getSnapshot().messages.at(-1)?.id).toBe("run-1"),
    );
    chat.stop();
    await sent;

    expect(chat.getSnapshot().status).toBe("ready");
    expect(errors).toEqual([]);
    expect(finishes[0]).toMatchObject({ isAbort: true, isError: false });
  });

  it("places the reply at acceptance but is streaming only once the Run produces something", async () => {
    let produce: () => void = () => {};

    const queued = new Promise<void>((resolve) => {
      produce = resolve;
    });

    const { chat } = chatWith({
      sendMessages: () =>
        Promise.resolve(
          (async function* () {
            yield started("run-1");
            await queued;
            yield* answer("run-1", "Hello");
            yield finished("run-1");
          })(),
        ),
    });

    const sent = chat.sendMessage({ text: "hi" });

    await vi.waitFor(() =>
      expect(chat.getSnapshot().messages.at(-1)).toEqual({
        id: "run-1",
        role: "assistant",
        parts: [],
      }),
    );
    // The Run is accepted and may still be queued: nothing has streamed yet.
    expect(chat.getSnapshot().status).toBe("submitted");

    const statuses: Array<string> = [];
    chat.subscribe(() => statuses.push(chat.getSnapshot().status));
    produce();
    await sent;

    expect(statuses).toContain("streaming");
    expect(chat.getSnapshot().status).toBe("ready");
  });

  it("yields a connecting attach to a send that overtakes it, and keeps that send stoppable", async () => {
    let answerAttach: (
      events: AsyncIterable<AGUIEvent> | null,
    ) => void = () => {};

    const { chat, finishes, errors } = chatWith({
      reconnectToStream: () =>
        new Promise((resolve) => {
          answerAttach = resolve;
        }),
      sendMessages: () =>
        Promise.resolve(
          (async function* () {
            yield started("run-2");
            await new Promise<never>(() => {});
          })(),
        ),
    });

    const attaching = chat.resumeStream();
    const sent = chat.sendMessage({ text: "hi" });

    await vi.waitFor(() =>
      expect(chat.getSnapshot().messages.at(-1)?.id).toBe("run-2"),
    );
    // The attach finds a Run after the send took the log: it must not write.
    answerAttach(eventsOf([started("run-1"), ...answer("run-1", "stale")]));
    await attaching;

    expect(chat.getSnapshot().messages.map((message) => message.id)).toEqual([
      "generated-id",
      "run-2",
    ]);

    chat.stop();
    await sent;

    expect(errors).toEqual([]);
    expect(finishes).toHaveLength(1);
    expect(finishes[0]).toMatchObject({ isAbort: true });
  });

  it("changes nothing and reports no finish when a resume finds no executing Run", async () => {
    const { chat, finishes } = chatWith(
      { reconnectToStream: () => Promise.resolve(null) },
      [USER],
    );

    const listener = vi.fn();
    chat.subscribe(listener);
    await chat.resumeStream();

    expect(listener).not.toHaveBeenCalled();
    expect(finishes).toEqual([]);
    expect(chat.getSnapshot()).toMatchObject({
      status: "ready",
      messages: [USER],
    });
  });

  it("rebuilds a reply the log already holds when a resume replays the Run from its start", async () => {
    const partial: UIMessage = {
      id: "run-1",
      role: "assistant",
      parts: [{ type: "text", text: "Hel", state: "streaming" }],
    };

    const { chat } = chatWith(
      {
        reconnectToStream: () =>
          Promise.resolve(
            eventsOf([
              started("run-1"),
              ...answer("run-1", "Hello"),
              finished("run-1"),
            ]),
          ),
      },
      [USER, partial],
    );

    await chat.resumeStream();

    expect(chat.getSnapshot().messages).toEqual([
      USER,
      {
        id: "run-1",
        role: "assistant",
        parts: [{ type: "text", text: "Hello", state: "done" }],
      },
    ]);
  });

  it("reports a failed attach as an error without a finish", async () => {
    const { chat, finishes, errors } = chatWith({
      reconnectToStream: () => Promise.reject(new TypeError("Failed to fetch")),
    });

    await chat.resumeStream();

    expect(chat.getSnapshot().status).toBe("error");
    expect(errors).toHaveLength(1);
    expect(finishes).toEqual([]);
  });

  it("does not start a second attach while a request owns the log", async () => {
    let release: () => void = () => {};

    const held = new Promise<void>((resolve) => {
      release = resolve;
    });

    const reconnectToStream = vi.fn(() => Promise.resolve(null));

    const { chat } = chatWith({
      reconnectToStream,
      sendMessages: () =>
        Promise.resolve(
          (async function* () {
            yield started("run-1");
            await held;
          })(),
        ),
    });

    const sent = chat.sendMessage({ text: "hi" });
    await vi.waitFor(() =>
      expect(chat.getSnapshot().messages.at(-1)?.id).toBe("run-1"),
    );
    await chat.resumeStream();
    release();
    await sent;

    expect(reconnectToStream).not.toHaveBeenCalled();
  });

  it("drops the turn's reply before a follow-up Run streams its replacement", async () => {
    const old: UIMessage = {
      id: "message-1",
      role: "assistant",
      parts: [{ type: "text", text: "old" }],
    };

    const { chat, requests } = chatWith(
      {
        sendMessages: () =>
          Promise.resolve(
            eventsOf([
              started("run-2"),
              ...answer("run-2", "new"),
              finished("run-2"),
            ]),
          ),
      },
      [USER, old],
    );

    await chat.regenerate({ body: { action: "regenerate", modelId: "m" } });

    expect(requests[0]).toMatchObject({
      trigger: "regenerate-message",
      body: { action: "regenerate", modelId: "m" },
      messages: [USER],
    });
    expect(chat.getSnapshot().messages.map((message) => message.id)).toEqual([
      "user-1",
      "run-2",
    ]);
  });
});
