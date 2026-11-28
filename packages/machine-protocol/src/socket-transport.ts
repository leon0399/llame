import type { Socket } from "node:net";
import type { Transport } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";

/** Creates an HTTP/2 Connect transport over a Unix-domain socket. */
export function connectSocket(socket: Socket): Transport {
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

        return socket;
      },
    },
  });
}
