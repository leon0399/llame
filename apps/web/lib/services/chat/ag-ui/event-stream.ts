import { EventType, type AGUIEvent } from "@ag-ui/core";
import { EventSchemas } from "@ag-ui/core/schemas";
import { EventSourceParserStream } from "eventsource-parser/stream";
import { z } from "zod";

const envelope = z.object({ type: z.string() });
const knownTypes = new Set<string>(Object.values(EventType));
const MAX_FRAME_CHARS = 10 * 1024 * 1024;

/**
 * Reads the SSE binding with the standard EventSource parser. Unknown event
 * types are ignored for protocol evolution; malformed known events fail the
 * connection rather than silently losing part of a reply.
 */
export async function* readAgUiEvents(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<AGUIEvent> {
  const decoder = new TextDecoder();

  const reader = body
    .pipeThrough(
      new TransformStream<Uint8Array, string>({
        transform(chunk, controller) {
          controller.enqueue(decoder.decode(chunk, { stream: true }));
        },
        flush(controller) {
          controller.enqueue(decoder.decode());
        },
      }),
    )
    .pipeThrough(
      new EventSourceParserStream({ maxBufferSize: MAX_FRAME_CHARS }),
    )
    .getReader();

  try {
    for (;;) {
      const { done, value } = await reader.read();

      if (done) return;
      const event = parseEvent(value.data);

      if (event !== null) yield event;
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

function parseEvent(data: string): AGUIEvent | null {
  if (data.length > MAX_FRAME_CHARS) {
    throw new Error("AG-UI event exceeds the chat stream size limit.");
  }

  try {
    const value: unknown = JSON.parse(data);
    const { type } = envelope.parse(value);

    return knownTypes.has(type) ? EventSchemas.parse(value) : null;
  } catch {
    // Never echo a malformed provider result or private tool arguments.
    throw new Error("Invalid AG-UI event in the chat stream.");
  }
}
