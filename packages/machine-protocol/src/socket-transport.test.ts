import { create } from "@bufbuild/protobuf";
import { ConnectError, createClient } from "@connectrpc/connect";
import { connect as connectNetSocket, createServer } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BootstrapService, GetInfoRequestSchema } from "./index";
import { connectSocket } from "./socket-transport";
import { describe, expect, it } from "vitest";

const request = create(GetInfoRequestSchema, {});

describe("connectSocket", () => {
  it("uses the supplied Unix socket for the Connect transport", async () => {
    const directory = mkdtempSync(
      join(tmpdir(), "machine-protocol-socket-test-"),
    );

    const path = join(directory, "machine.sock");
    const server = createServer((socket) => socket.destroy());

    try {
      const listening = new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(path, resolve);
      });

      await listening;

      const transport = connectSocket(connectNetSocket(path));

      const response = createClient(BootstrapService, transport).getInfo(
        request,
        {
          timeoutMs: 2000,
        },
      );

      await expect(response).rejects.toBeInstanceOf(ConnectError);
    } finally {
      const closed = new Promise<void>((resolve) =>
        server.close(() => resolve()),
      );

      await closed;
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
