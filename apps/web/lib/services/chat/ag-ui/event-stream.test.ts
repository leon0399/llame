import { describe, expect, it } from "vitest";

import { readAgUiEvents } from "./event-stream";

function streamOf(chunks: Array<string>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();

  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

async function read(chunks: Array<string>) {
  const events = [];

  for await (const event of readAgUiEvents(streamOf(chunks))) {
    events.push(event);
  }

  return events;
}

const STARTED = { type: "RUN_STARTED", threadId: "chat-1", runId: "run-1" };

const CONTENT = {
  type: "TEXT_MESSAGE_CONTENT",
  messageId: "run-1:text-1",
  delta: "héllo",
};

describe("readAgUiEvents", () => {
  it("reads one event per data frame", async () => {
    expect(
      await read([
        `data: ${JSON.stringify(STARTED)}\n\ndata: ${JSON.stringify(CONTENT)}\n\n`,
      ]),
    ).toEqual([STARTED, CONTENT]);
  });

  it("joins a frame and a multi-byte character split across network reads", async () => {
    const bytes = new TextEncoder().encode(
      `data: ${JSON.stringify(CONTENT)}\n\n`,
    );

    // Cut inside the two-byte "é".
    const cut = bytes.indexOf(0xc3) + 1;

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, cut));
        controller.enqueue(bytes.slice(cut));
        controller.close();
      },
    });

    const events = [];

    for await (const event of readAgUiEvents(stream)) events.push(event);

    expect(events).toEqual([CONTENT]);
  });

  it("skips keepalives and unknown event types", async () => {
    expect(
      await read([
        ": keepalive\n\n",
        `data: ${JSON.stringify({ type: "FUTURE_EVENT", payload: 1 })}\n\n`,
        `data: ${JSON.stringify(STARTED)}\n\n`,
      ]),
    ).toEqual([STARTED]);
  });

  it.each(["not json", JSON.stringify({ type: "RUN_STARTED" })])(
    "rejects malformed data before a successful terminal event: %s",
    async (data) => {
      await expect(
        read([
          `data: ${data}\n\ndata: ${JSON.stringify({
            type: "RUN_FINISHED",
            threadId: "chat-1",
            runId: "run-1",
          })}\n\n`,
        ]),
      ).rejects.toThrow("Invalid AG-UI event");
    },
  );

  it("reads multiline data with CRLF split between network chunks", async () => {
    expect(
      await read([
        'data: {"type":"RUN_STARTED",\r',
        '\ndata: "threadId":"chat-1","runId":"run-1"}\r',
        "\n\r",
        "\n",
      ]),
    ).toEqual([STARTED]);
  });

  it("retains a large frame delivered in small network chunks", async () => {
    const event = { ...CONTENT, delta: "x".repeat(1_000_000) };
    const frame = `data: ${JSON.stringify(event)}\n\n`;
    const chunks = [];

    for (let offset = 0; offset < frame.length; offset += 1024) {
      chunks.push(frame.slice(offset, offset + 1024));
    }

    expect(await read(chunks)).toEqual([event]);
  });

  it.each([false, true])(
    "rejects an oversized terminated frame, split=%s",
    async (split) => {
      const frame = `data: ${JSON.stringify({
        ...CONTENT,
        delta: "x".repeat(10 * 1024 * 1024),
      })}\n\n`;

      const chunks = split
        ? [frame.slice(0, 1024), frame.slice(1024)]
        : [frame];

      await expect(read(chunks)).rejects.toThrow("size limit");
    },
  );

  it("drops an unterminated trailing frame: the connection was cut mid-event", async () => {
    expect(
      await read([
        `data: ${JSON.stringify(STARTED)}\n\ndata: {"type":"TEXT_MESS`,
      ]),
    ).toEqual([STARTED]);
  });
});
