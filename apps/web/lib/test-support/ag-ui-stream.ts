import { EventType, type AGUIEvent } from "@ag-ui/core";
import type { JSONValue } from "ai";

/**
 * A Run's stream as the api writes it — AG-UI events over SSE — for stories and
 * tests that answer the chat's stream requests themselves.
 */

export type AgUiStreamWriter = {
  write(events: Array<AGUIEvent>): void;
};

/** The response of a stream request: every event `execute` writes, one per SSE
 *  frame. The stream closes when `execute` settles. */
export function agUiStreamResponse(
  execute: (writer: AgUiStreamWriter) => Promise<void> | void,
): Response {
  const encoder = new TextEncoder();

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      await execute({
        write(events) {
          for (const event of events) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
            );
          }
        },
      });
      controller.close();
    },
  });

  return new Response(body, {
    headers: { "content-type": "text/event-stream" },
  });
}

type JsonObject = Record<string, JSONValue>;

/** The events of one Run, named for what they do to its reply. */
export class AgUiRunEvents {
  private readonly textMessageId: string;

  constructor(
    private readonly runId: string,
    private readonly threadId = "chat",
  ) {
    this.textMessageId = `${runId}:text-1`;
  }

  started(): AGUIEvent {
    return {
      type: EventType.RUN_STARTED,
      threadId: this.threadId,
      runId: this.runId,
    };
  }

  finished(): AGUIEvent {
    return {
      type: EventType.RUN_FINISHED,
      threadId: this.threadId,
      runId: this.runId,
    };
  }

  textStart(): AGUIEvent {
    return {
      type: EventType.TEXT_MESSAGE_START,
      messageId: this.textMessageId,
      role: "assistant",
    };
  }

  textDelta(delta: string): AGUIEvent {
    return {
      type: EventType.TEXT_MESSAGE_CONTENT,
      messageId: this.textMessageId,
      delta,
    };
  }

  textEnd(): AGUIEvent {
    return { type: EventType.TEXT_MESSAGE_END, messageId: this.textMessageId };
  }

  toolCall(
    toolCallId: string,
    toolCallName: string,
    input: JsonObject,
  ): Array<AGUIEvent> {
    return [
      { type: EventType.TOOL_CALL_START, toolCallId, toolCallName },
      {
        type: EventType.TOOL_CALL_ARGS,
        toolCallId,
        delta: JSON.stringify(input),
      },
      { type: EventType.TOOL_CALL_END, toolCallId },
    ];
  }

  toolResult(toolCallId: string, output: JsonObject): AGUIEvent {
    return {
      type: EventType.TOOL_CALL_RESULT,
      messageId: `${toolCallId}:result`,
      toolCallId,
      role: "tool",
      content: JSON.stringify(output),
    };
  }

  /** The segment ended at a delivered message; the Run goes on. */
  delivered(messageId: string): AGUIEvent {
    return {
      type: EventType.CUSTOM,
      name: "llame.run-delivered",
      value: { messageId },
    };
  }
}
