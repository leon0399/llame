import { spawn, type ChildProcess } from "node:child_process";
import { Duplex, type Readable, type Writable } from "node:stream";
import type { Transport } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";

/** One HTTP/2 connection carried on a child's stdio. */
export type StdioConnection = {
  readonly transport: Transport;
  readonly child?: ChildProcess;
  /** Ends the connection and, for a spawned connection, the child. */
  close(): void;
};

export type StdioConnectionOptions = {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly env?: NodeJS.ProcessEnv;
  /** Receives the child's standard error, which never carries gRPC bytes. */
  readonly onStderr?: (text: string) => void;
};

/** Existing stdio streams, such as a child process opened by the SSH factory. */
export type StdioStreamsOptions = {
  readonly streams: {
    readonly input: Readable;
    readonly output: Writable;
    close(): void;
  };
};

type StdioChannels = {
  readonly child?: ChildProcess;
  readonly input: Readable;
  readonly output: Writable;
  readonly close?: () => void;
};

function spawnStdioChannels(options: StdioConnectionOptions): StdioChannels {
  const child = spawn(options.command, [...options.args], {
    env: options.env,
    shell: false,
    stdio: ["pipe", "pipe", "pipe"],
  });

  if (child.stdin === null || child.stdout === null || child.stderr === null) {
    throw new Error("The Machine connection has no stdio.");
  }

  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (text: string) => options.onStderr?.(text));

  return {
    child,
    input: child.stdout,
    output: child.stdin,
  };
}

function createTransport(input: Readable, output: Writable): Transport {
  const duplex = Duplex.from({ readable: input, writable: output });
  let used = false;

  return createGrpcTransport({
    baseUrl: "http://machine",
    idleConnectionTimeoutMs: 2 ** 31 - 1,
    pingIntervalMs: 15_000,
    pingTimeoutMs: 45_000,
    readMaxBytes: 4 * 1024 * 1024,
    writeMaxBytes: 4 * 1024 * 1024,
    nodeOptions: {
      createConnection: () => {
        if (used) throw new Error("The Machine connection is closed.");

        used = true;

        return duplex;
      },
    },
  });
}

/**
 * Starts a daemon (or wraps an already-started local/SSH child) and speaks
 * Connect gRPC over its stdin and stdout. Each call owns one HTTP/2 connection.
 */
export function connectStdio(
  options: StdioConnectionOptions | StdioStreamsOptions,
): StdioConnection {
  const channels =
    "streams" in options
      ? {
          input: options.streams.input,
          output: options.streams.output,
          close: () => options.streams.close(),
        }
      : spawnStdioChannels(options);

  const transport = createTransport(channels.input, channels.output);

  const close = () => {
    channels.close?.();

    if (
      channels.child !== undefined &&
      channels.child.exitCode === null &&
      channels.child.signalCode === null
    ) {
      channels.child.kill("SIGTERM");
    }
  };

  if (channels.child === undefined) return { transport, close };

  return { transport, child: channels.child, close };
}
