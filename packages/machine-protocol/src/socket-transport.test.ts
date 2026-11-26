import { create } from "@bufbuild/protobuf";
import { createClient } from "@connectrpc/connect";
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
    const directory = mkdtempSync(join(tmpdir(), "machine-protocol-socket-test-"));
    const path = join(directory, "machine.sock");
    const server = createServer((socket) => socket.destroy());

    try {
      const listening = Promise.withResolvers<void>();
      server.once("error", listening.reject);
      server.listen(path, listening.resolve);
      await listening.promise;

      const transport = connectSocket(connectNetSocket(path));
      const response = createClient(BootstrapService, transport).getInfo(request, {
        timeoutMs: 2_000,
      });

      await expect(response).rejects.toThrow();
    } finally {
      const closed = Promise.withResolvers<void>();
      server.close(closed.resolve);
      await closed.promise;
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
