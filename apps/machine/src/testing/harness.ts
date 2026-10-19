import { PassThrough, type Readable, type Writable } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";
import {
  createFrameMultiplexer,
  createLineFramer,
  decodeFrame,
  encodeFrame,
  PROTOCOL_VERSION,
  type Frame,
  type FrameMultiplexer,
  type JsonValue,
  type MachineChannel,
  type MachineMethod,
  type MachineMethodParams,
} from "@workspace/machine-protocol";
import {
  serveMachine,
  type MachineSession,
  type ServeMachineOptions,
} from "../serve";

export type Attempt = {
  readonly ok: boolean;
  readonly value?: JsonValue;
  readonly error?: unknown;
};

export type TestChannel = {
  readonly channel: MachineChannel;
  readonly notifications: Array<{
    readonly method: string;
    readonly params?: JsonValue;
  }>;
};

export type TestDaemon = {
  readonly session: MachineSession;
  /** The daemon's stdin; ending it is a hub that went away. */
  readonly input: PassThrough;
  /** Every frame the daemon sent, decoded. */
  readonly frames: Array<Frame>;
  open(): TestChannel;
  hello(protocolVersion?: number): Promise<Attempt>;
  call<M extends MachineMethod>(
    method: M,
    params: MachineMethodParams[M],
    options?: { readonly signal?: AbortSignal },
  ): Promise<JsonValue>;
  attempt<M extends MachineMethod>(
    method: M,
    params: MachineMethodParams[M],
    options?: { readonly signal?: AbortSignal },
  ): Promise<Attempt>;
  write(text: string): void;
  closeInput(): void;
};

export function envelope(budgetMs = 30_000) {
  return { budgetMs };
}

/** Every frame the daemon sends, decoded as it arrives. */
function collectFrames(
  output: Readable,
  onFrame: (frame: Frame) => void,
): void {
  const framer = createLineFramer();
  output.on("data", (chunk: Buffer) => {
    for (const event of framer.push(chunk)) {
      if (event.kind !== "line") continue;
      const decoded = decodeFrame(event.line);
      if (decoded.ok) onFrame(decoded.frame);
    }
  });
}

function openChannel(multiplexer: FrameMultiplexer): TestChannel {
  const channel = multiplexer.open();
  const notifications: TestChannel["notifications"] = [];
  channel.onNotification((message) => {
    notifications.push({ method: message.method, params: message.params });
  });
  return { channel, notifications };
}

async function attemptOn<M extends MachineMethod>(
  multiplexer: FrameMultiplexer,
  method: M,
  params: MachineMethodParams[M],
  options?: { readonly signal?: AbortSignal },
): Promise<Attempt> {
  const { channel } = openChannel(multiplexer);
  try {
    return { ok: true, value: await channel.request(method, params, options) };
  } catch (error) {
    return { ok: false, error };
  } finally {
    channel.close();
  }
}

async function helloOn(
  multiplexer: FrameMultiplexer,
  protocolVersion: number,
): Promise<Attempt> {
  try {
    return {
      ok: true,
      value: await multiplexer.control.request("hello", {
        protocolVersion,
        hubVersion: "test-hub",
      }),
    };
  } catch (error) {
    return { ok: false, error };
  }
}

/** A hub-side client: ids, framing, and requests, as the hub would run them. */
function createClient(input: Writable, output: Readable) {
  const frames: Array<Frame> = [];
  const multiplexer = createFrameMultiplexer({
    send: (frame) => {
      input.write(encodeFrame(frame));
    },
  });
  collectFrames(output, (frame) => {
    frames.push(frame);
    multiplexer.handle(frame);
  });
  return {
    frames,
    multiplexer,
    open: () => openChannel(multiplexer),
    attempt: <M extends MachineMethod>(
      method: M,
      params: MachineMethodParams[M],
      options?: { readonly signal?: AbortSignal },
    ) => attemptOn(multiplexer, method, params, options),
  };
}

/** The daemon in-process over pipes, with a hub-side client on the other end. */
export function startDaemon(options: ServeMachineOptions = {}): TestDaemon {
  const input = new PassThrough();
  const output = new PassThrough();
  const session = serveMachine(input, output, {
    heartbeatIntervalMs: 60_000,
    ...options,
  });
  const client = createClient(input, output);
  return {
    session,
    input,
    frames: client.frames,
    open: client.open,
    attempt: client.attempt,
    hello: (protocolVersion = PROTOCOL_VERSION) =>
      helloOn(client.multiplexer, protocolVersion),
    call: async (method, params, callOptions) => {
      const outcome = await client.attempt(method, params, callOptions);
      if (!outcome.ok) throw outcome.error;
      return outcome.value ?? null;
    },
    write: (text) => {
      input.write(text);
    },
    closeInput: () => {
      input.end();
    },
  };
}

export async function waitFor(
  condition: () => boolean,
  timeoutMs = 3000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline)
      throw new Error("Timed out waiting for a change.");
    await delay(10);
  }
}

/** Whether a process group (the pid of a detached child) is already gone. */
export function isGone(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return false;
  } catch {
    return true;
  }
}
