import { describe, expect, it } from "vitest";
import type {
  Frame,
  JsonRpcRequest,
  JsonRpcSuccess,
  JsonValue,
  MachineChannel,
} from "./index";
import {
  createFrameMultiplexer,
  encodeFrame,
  FrameSizeError,
  MachineProtocolError,
  StreamClosedError,
} from "./index";

type Sent = { readonly frame: Frame; readonly line: string };

function build(options?: {
  readonly maxOpenStreams?: number;
  readonly encode?: boolean;
}) {
  const sent: Array<Sent> = [];
  const unknown: Array<Frame> = [];
  const opened: Array<{ channel: MachineChannel; request: JsonRpcRequest }> =
    [];
  const multiplexerOptions = {
    send: (frame: Frame) => {
      sent.push({
        frame,
        line: options?.encode === true ? encodeFrame(frame) : "",
      });
    },
    onRequest: (channel: MachineChannel, request: JsonRpcRequest) =>
      opened.push({ channel, request }),
    onUnknownFrame: (frame: Frame) => unknown.push(frame),
  };
  const mux = createFrameMultiplexer(
    options?.maxOpenStreams === undefined
      ? multiplexerOptions
      : { ...multiplexerOptions, maxOpenStreams: options.maxOpenStreams },
  );
  return { mux, sent, unknown, opened };
}

function settle(
  promise: Promise<unknown>,
): Promise<{ ok: boolean; error?: unknown }> {
  return promise.then(
    () => ({ ok: true }),
    (error: unknown) => ({ ok: false, error }),
  );
}

function isProtocolError(error: unknown): error is MachineProtocolError {
  return error instanceof MachineProtocolError;
}

function success(id: number, result: JsonValue): Frame {
  const message: JsonRpcSuccess = { jsonrpc: "2.0", id, result };
  return { s: id, m: message };
}

describe("stream identity", () => {
  it("opens strictly increasing ids and never reuses a closed one", () => {
    const { mux } = build();
    const first = mux.open();
    expect(first.id).toBe(1);
    first.close();
    const second = mux.open();
    expect(second.id).toBe(2);
    expect(mux.openStreams).toBe(1);
  });

  it("drops a late frame instead of answering another stream", async () => {
    const { mux, unknown } = build();
    const closed = mux.open();
    const pending = settle(
      closed.request("roots.list", { envelope: { budgetMs: 5 } }),
    );
    closed.close();
    expect((await pending).error).toBeInstanceOf(StreamClosedError);
    const live = mux.open();
    const livePending = settle(
      live.request("roots.list", { envelope: { budgetMs: 5 } }),
    );
    mux.handle(success(closed.id, { roots: ["/late"] }));
    expect(unknown).toEqual([success(closed.id, { roots: ["/late"] })]);
    let settled = false;
    void livePending.then(() => {
      settled = true;
    });
    mux.handle(success(live.id, { roots: ["/srv"] }));
    expect(await livePending).toEqual({ ok: true });
    expect(settled).toBe(true);
  });

  it("ignores a response whose id does not match the pending request", async () => {
    const { mux, unknown } = build();
    const channel = mux.open();
    const pending = settle(
      channel.request("roots.list", { envelope: { budgetMs: 5 } }),
    );
    const wrongId: JsonRpcSuccess = {
      jsonrpc: "2.0",
      id: 99,
      result: { roots: ["/wrong"] },
    };
    mux.handle({ s: channel.id, m: wrongId });
    let settled = false;
    void pending.then(() => {
      settled = true;
    });
    expect(unknown).toEqual([]);
    expect(settled).toBe(false);
    mux.handle(success(channel.id, { roots: ["/srv"] }));
    expect(await pending).toEqual({ ok: true });
  });
});

describe("request streams", () => {
  it("carries concurrent requests independently", async () => {
    const { mux, sent } = build();
    const first = mux.open();
    const second = mux.open();
    const firstPending = first.request("roots.list", {
      envelope: { budgetMs: 5 },
    });
    const secondPending = second.request("fs.stat", {
      envelope: { budgetMs: 5 },
      path: "/srv",
    });
    expect(sent.map(({ frame }) => frame.s)).toEqual([1, 2]);
    mux.handle(success(2, { kind: "directory", isLink: false }));
    mux.handle(success(1, { roots: ["/srv"] }));
    expect(await secondPending).toEqual({ kind: "directory", isLink: false });
    expect(await firstPending).toEqual({ roots: ["/srv"] });
  });

  it("refuses a second request on one stream", async () => {
    const { mux } = build();
    const channel = mux.open();
    void channel
      .request("roots.list", { envelope: { budgetMs: 5 } })
      .catch(() => {});
    await expect(
      channel.request("roots.list", { envelope: { budgetMs: 5 } }),
    ).rejects.toThrow("already carries a request");
  });

  it("cancels a stream when the caller's signal aborts", async () => {
    const { mux, sent } = build();
    const channel = mux.open();
    const controller = new AbortController();
    const pending = settle(
      channel.request(
        "proc.bash",
        { envelope: { budgetMs: 5 }, command: "sleep 30" },
        {
          signal: controller.signal,
        },
      ),
    );
    controller.abort();
    expect(sent.at(-1)?.frame).toEqual({
      s: channel.id,
      m: { jsonrpc: "2.0", method: "cancel" },
    });
    expect(channel.closed).toBe(true);
    expect(channel.signal.aborted).toBe(true);
    expect((await pending).error).toBeInstanceOf(StreamClosedError);
  });

  it("rejects and closes a request whose signal is already aborted, sending nothing", async () => {
    const { mux, sent } = build();
    const channel = mux.open();
    const before = sent.length;
    const controller = new AbortController();
    controller.abort();
    await expect(
      channel.request(
        "roots.list",
        { envelope: { budgetMs: 5 } },
        { signal: controller.signal },
      ),
    ).rejects.toBeInstanceOf(StreamClosedError);
    expect(channel.closed).toBe(true);
    expect(sent.length).toBe(before);
  });

  it("fails a request whose own message is oversize", async () => {
    const { mux } = build({ encode: true });
    const channel = mux.open();
    await expect(
      channel.request("fs.write", {
        envelope: { budgetMs: 5 },
        path: "/srv/big.txt",
        options: { displayPrefix: "machine://devl" },
        content: "x".repeat(1024 * 1024 + 1),
      }),
    ).rejects.toThrow(FrameSizeError);
    expect(mux.openStreams).toBe(1);
  });
});

describe("errors and control", () => {
  it("lifts the Machine code out of a remote error", async () => {
    const { mux } = build();
    const channel = mux.open();
    const pending = settle(
      channel.request("fs.read", {
        envelope: { budgetMs: 5 },
        path: "/etc/passwd",
        options: { displayPrefix: "machine://devl" },
      }),
    );
    mux.handle({
      s: channel.id,
      m: {
        jsonrpc: "2.0",
        id: channel.id,
        error: {
          code: -32_001,
          message: "refused",
          data: { code: "path_not_registered" },
        },
      },
    });
    const outcome = await pending;
    expect(outcome.error).toBeInstanceOf(MachineProtocolError);
    if (!isProtocolError(outcome.error)) throw new Error("no protocol error");
    expect(outcome.error.code).toBe("path_not_registered");
  });

  it("reports an error without a known code as internal", async () => {
    const { mux } = build();
    const channel = mux.open();
    const pending = settle(
      channel.request("roots.list", { envelope: { budgetMs: 5 } }),
    );
    mux.handle({
      s: channel.id,
      m: {
        jsonrpc: "2.0",
        id: channel.id,
        error: { code: -1, message: "odd", data: { code: "surprising" } },
      },
    });
    const outcome = await pending;
    if (!isProtocolError(outcome.error)) throw new Error("no protocol error");
    expect(outcome.error.code).toBe("internal");
  });

  it("answers a request on the stream it arrived on", () => {
    const { mux, sent, opened } = build();
    mux.handle({
      s: 4,
      m: {
        jsonrpc: "2.0",
        id: 4,
        method: "fs.stat",
        params: { envelope: { budgetMs: 5 }, path: "/srv" },
      },
    });
    const { channel } = opened[0];
    expect(channel.id).toBe(4);
    channel.result({ kind: "directory", isLink: false });
    channel.error("internal", "no", { detail: "later" });
    expect(sent.map(({ frame }) => frame.m)).toEqual([
      { jsonrpc: "2.0", id: 4, result: { kind: "directory", isLink: false } },
      {
        jsonrpc: "2.0",
        id: 4,
        error: {
          code: -32_603,
          message: "no",
          data: { detail: "later", code: "internal" },
        },
      },
    ]);
  });

  it("closes a stream on the peer's cancel notification", async () => {
    const { mux, opened } = build();
    mux.handle({
      s: 1,
      m: {
        jsonrpc: "2.0",
        id: 1,
        method: "proc.bash",
        params: { envelope: { budgetMs: 5 } },
      },
    });
    const { channel } = opened[0];
    const closed = new Promise<boolean>((resolve) => {
      channel.onClose(() => resolve(true));
    });
    mux.handle({ s: 1, m: { jsonrpc: "2.0", method: "cancel", params: {} } });
    expect(await closed).toBe(true);
    expect(channel.closed).toBe(true);
    expect(channel.signal.aborted).toBe(true);
    channel.result({ ignored: true });
    expect(mux.openStreams).toBe(0);
  });

  it("refuses a request beyond the stream cap", () => {
    const { mux, sent, unknown } = build({ maxOpenStreams: 1 });
    mux.open();
    const request: JsonRpcRequest = {
      jsonrpc: "2.0",
      id: 9,
      method: "roots.list",
      params: { envelope: { budgetMs: 5 } },
    };
    mux.handle({ s: 9, m: request });
    expect(sent[0].frame).toEqual({
      s: 9,
      m: {
        jsonrpc: "2.0",
        id: 9,
        error: {
          code: -32_603,
          message: "The session already carries the maximum number of streams.",
          data: { code: "internal" },
        },
      },
    });
    mux.handle({ s: 9, m: request });
    expect(unknown).toHaveLength(1);
    expect(() => mux.open()).toThrow("maximum number of streams");
  });

  it("fails every open stream when the session closes", async () => {
    const { mux } = build();
    const channel = mux.open();
    const pending = settle(
      channel.request("roots.list", { envelope: { budgetMs: 5 } }),
    );
    const controlPending = settle(
      mux.control.request("hello", { protocolVersion: 1, hubVersion: "1" }),
    );
    mux.close();
    expect(channel.closed).toBe(true);
    mux.handle(success(channel.id, { roots: [] }));
    expect((await pending).error).toBeInstanceOf(StreamClosedError);
    expect((await controlPending).error).toBeInstanceOf(StreamClosedError);
    expect(() => mux.open()).toThrow("session is closed");
  });

  it("exchanges the handshake and notifications on the control stream", () => {
    const { mux, sent, opened } = build();
    const notifications: Array<string> = [];
    mux.control.onNotification((message) => notifications.push(message.method));
    void mux.control
      .request("hello", { protocolVersion: 1, hubVersion: "1" })
      .then((result) => notifications.push(JSON.stringify(result)));
    expect(sent[0].frame).toEqual({
      s: 0,
      m: {
        jsonrpc: "2.0",
        id: 0,
        method: "hello",
        params: { protocolVersion: 1, hubVersion: "1" },
      },
    });
    mux.handle({
      s: 0,
      m: {
        jsonrpc: "2.0",
        id: 0,
        result: { protocolVersion: 1, daemonVersion: "1", roots: [] },
      },
    });
    mux.control.notify("ping");
    mux.handle({ s: 0, m: { jsonrpc: "2.0", method: "ping" } });
    expect(notifications).toEqual(["ping"]);
    mux.control.close();
    expect(mux.control.closed).toBe(false);
    expect(opened).toHaveLength(0);
  });
});
