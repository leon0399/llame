import { EventType, type AGUIEvent } from "@ag-ui/core";
import { describe, expect, it } from "vitest";

import { ReplyReducer } from "./reply";

function replyOf(events: Array<AGUIEvent>) {
  const reducer = new ReplyReducer();

  for (const event of events) reducer.apply(event);

  return reducer.reply();
}

const text = (messageId: string, delta: string): Array<AGUIEvent> => [
  { type: EventType.TEXT_MESSAGE_START, messageId, role: "assistant" },
  { type: EventType.TEXT_MESSAGE_CONTENT, messageId, delta },
  { type: EventType.TEXT_MESSAGE_END, messageId },
];

const reasoning = (messageId: string, delta: string): Array<AGUIEvent> => [
  { type: EventType.REASONING_START, messageId },
  { type: EventType.REASONING_MESSAGE_START, messageId, role: "reasoning" },
  { type: EventType.REASONING_MESSAGE_CONTENT, messageId, delta },
  { type: EventType.REASONING_MESSAGE_END, messageId },
  { type: EventType.REASONING_END, messageId },
];

const toolCall = (
  toolCallId: string,
  input: Record<string, string>,
): Array<AGUIEvent> => [
  { type: EventType.TOOL_CALL_START, toolCallId, toolCallName: "bash" },
  { type: EventType.TOOL_CALL_ARGS, toolCallId, delta: JSON.stringify(input) },
  { type: EventType.TOOL_CALL_END, toolCallId },
];

describe("ReplyReducer", () => {
  it("keeps the parts of a reply apart and in arrival order", () => {
    const reply = replyOf([
      { type: EventType.RUN_STARTED, threadId: "chat-1", runId: "run-1" },
      ...reasoning("run-1:reasoning-1", "plan"),
      ...text("run-1:text-1", "First."),
      ...reasoning("run-1:reasoning-2", "check"),
      ...text("run-1:text-2", "Second."),
    ]);

    expect(reply.runId).toBe("run-1");
    expect(reply.parts).toEqual([
      { type: "reasoning", text: "plan", state: "done" },
      { type: "text", text: "First.", state: "done" },
      { type: "reasoning", text: "check", state: "done" },
      { type: "text", text: "Second.", state: "done" },
    ]);
  });

  it("joins the deltas of one message and marks it streaming until it ends", () => {
    const reducer = new ReplyReducer();
    const messageId = "run-1:text-1";

    reducer.apply({
      type: EventType.TEXT_MESSAGE_START,
      messageId,
      role: "assistant",
    });
    reducer.apply({
      type: EventType.TEXT_MESSAGE_CONTENT,
      messageId,
      delta: "Hel",
    });
    reducer.apply({
      type: EventType.TEXT_MESSAGE_CONTENT,
      messageId,
      delta: "lo",
    });

    expect(reducer.reply().parts).toEqual([
      { type: "text", text: "Hello", state: "streaming" },
    ]);
  });

  it("follows a tool call from its arguments to its parsed output", () => {
    const reducer = new ReplyReducer();

    for (const event of toolCall("c1", { command: "ls" })) reducer.apply(event);

    expect(reducer.reply().parts).toEqual([
      {
        type: "dynamic-tool",
        toolCallId: "c1",
        toolName: "bash",
        state: "input-available",
        input: { command: "ls" },
      },
    ]);

    reducer.apply({
      type: EventType.TOOL_CALL_RESULT,
      messageId: "c1:result",
      toolCallId: "c1",
      role: "tool",
      content: '{"status":"success","stdout":"a"}',
    });

    expect(reducer.reply().parts).toEqual([
      {
        type: "dynamic-tool",
        toolCallId: "c1",
        toolName: "bash",
        state: "output-available",
        input: { command: "ls" },
        output: { status: "success", stdout: "a" },
      },
    ]);
  });

  it("settles a failed tool call as an error and keeps why it ended", () => {
    const reply = replyOf([
      ...toolCall("c1", {}),
      {
        type: EventType.TOOL_CALL_RESULT,
        messageId: "c1:result",
        toolCallId: "c1",
        role: "tool",
        content: "exit 2",
        metadata: { llame: { error: true } },
      },
      ...toolCall("c2", {}),
      {
        type: EventType.TOOL_CALL_RESULT,
        messageId: "c2:result",
        toolCallId: "c2",
        role: "tool",
        content: "Cancelled.",
        metadata: { llame: { error: true, cancelled: true } },
      },
    ]);

    expect(reply.parts).toEqual([
      expect.objectContaining({ state: "output-error", errorText: "exit 2" }),
      expect.objectContaining({
        state: "output-error",
        errorText: "Cancelled.",
        resultProviderMetadata: { llame: { cancelled: true } },
      }),
    ]);
    expect(reply.parts[0]).not.toHaveProperty("resultProviderMetadata");
  });

  it.each([false, true])(
    "keeps the intent across argument and result transitions (failed=%s)",
    (failed) => {
      const reducer = new ReplyReducer();

      for (const event of toolCall("c1", { command: "pwd" })) {
        reducer.apply(
          event.type === EventType.TOOL_CALL_START
            ? {
                ...event,
                metadata: { llame: { intent: "Checking the directory" } },
              }
            : event,
        );
      }

      expect(reducer.reply().parts[0]).toMatchObject({
        intent: "Checking the directory",
        input: { command: "pwd" },
        state: "input-available",
      });
      reducer.apply({
        type: EventType.TOOL_CALL_RESULT,
        messageId: "c1:result",
        toolCallId: "c1",
        role: "tool",
        content: failed ? "Stopped" : '{"stdout":"/work"}',
        ...(failed && { metadata: { llame: { error: true } } }),
      });
      expect(reducer.reply().parts[0]).toMatchObject({
        intent: "Checking the directory",
        state: failed ? "output-error" : "output-available",
      });
    },
  );

  it("places a notice among the parts where the stream carried it", () => {
    const reply = replyOf([
      ...text("run-1:text-1", "Working."),
      {
        type: EventType.CUSTOM,
        name: "llame.cap-notice",
        value: { stepsUsed: 3, maxSteps: 3 },
      },
      {
        type: EventType.CUSTOM,
        name: "llame.run-delivered",
        value: { messageId: "m1" },
      },
    ]);

    expect(reply.parts.slice(1)).toEqual([
      { type: "data-cap-notice", data: { stepsUsed: 3, maxSteps: 3 } },
      { type: "data-run-delivered", data: { messageId: "m1" } },
    ]);
  });

  it("merges reply metadata and ignores a custom event it does not know", () => {
    const reducer = new ReplyReducer();

    reducer.apply({
      type: EventType.CUSTOM,
      name: "llame.message-metadata",
      value: { usage: { runId: "run-1" } },
    });

    expect(
      reducer.apply({ type: EventType.CUSTOM, name: "other.event", value: 1 }),
    ).toBe(false);
    expect(reducer.reply()).toMatchObject({
      metadata: { usage: { runId: "run-1" } },
      parts: [],
    });
  });

  it("tells a finished run from a failed one and from a stream that just stopped", () => {
    const started: AGUIEvent = {
      type: EventType.RUN_STARTED,
      threadId: "chat-1",
      runId: "run-1",
    };

    expect(replyOf([started])).toMatchObject({
      finished: false,
      errorText: null,
    });
    expect(
      replyOf([
        started,
        { type: EventType.RUN_FINISHED, threadId: "chat-1", runId: "run-1" },
      ]),
    ).toMatchObject({ finished: true, errorText: null });
    expect(
      replyOf([started, { type: EventType.RUN_ERROR, message: "Run failed." }]),
    ).toMatchObject({ finished: false, errorText: "Run failed." });
  });

  it("leaves a snapshot a reader holds unchanged by later events", () => {
    const reducer = new ReplyReducer();
    const messageId = "run-1:text-1";

    reducer.apply({
      type: EventType.TEXT_MESSAGE_START,
      messageId,
      role: "assistant",
    });
    const before = reducer.reply().parts;

    reducer.apply({
      type: EventType.TEXT_MESSAGE_CONTENT,
      messageId,
      delta: "later",
    });

    expect(before).toEqual([{ type: "text", text: "", state: "streaming" }]);
  });
});
