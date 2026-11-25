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

/**
 * Starts a daemon (or wraps an already-started local/SSH child) and speaks
 * Connect gRPC over its stdin and stdout. Each call owns one HTTP/2 connection.
 */
export function connectStdio(
  options: StdioConnectionOptions | StdioStreamsOptions,
): StdioConnection {
  let child: ChildProcess | undefined;
  let input: Readable;
  let output: Writable;
  let closeStreams: (() => void) | undefined;

  if ("streams" in options) {
    ({ input, output, close: closeStreams } = options.streams);
  } else {
    child = spawn(options.command, [...options.args], {
      env: options.env,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });
    if (child.stdin === null || child.stdout === null || child.stderr === null)
      throw new Error("The Machine connection has no stdio.");
    input = child.stdout;
    output = child.stdin;
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (text: string) => options.onStderr?.(text));
  }

  const duplex = Duplex.from({ readable: input, writable: output });
  let used = false;
  const transport = createGrpcTransport({
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

  return {
    transport,
    ...(child === undefined ? {} : { child }),
    close() {
      closeStreams?.();
      if (
        child !== undefined &&
        child.exitCode === null &&
        child.signalCode === null
      )
        child.kill("SIGTERM");
    },
  };
}
