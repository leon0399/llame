import { create } from "@bufbuild/protobuf";
import { createClient } from "@connectrpc/connect";
import { PassThrough } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";
import { BootstrapService, GetInfoRequestSchema } from "./index";
import { connectStdio } from "./stdio-transport";
import { describe, expect, it, vi } from "vitest";

const request = create(GetInfoRequestSchema, {});

describe("connectStdio", () => {
  it("spawns a child, forwards stderr, and closes the child", async () => {
    const stderr = vi.fn();

    const connection = connectStdio({
      command: process.execPath,
      args: [
        "-e",
        String.raw`process.stdin.on('data', () => {}); process.stderr.write('ready\n')`,
      ],
      onStderr: stderr,
    });

    const client = createClient(BootstrapService, connection.transport);
    const response = client.getInfo(request, { timeoutMs: 2000 });

    try {
      await vi.waitFor(() => expect(stderr).toHaveBeenCalledWith("ready\n"));
      expect(connection.child).toBeDefined();
    } finally {
      connection.close();
    }

    await expect(response).rejects.toThrow("unavailable");
  });

  it("wraps existing streams and invokes their close hook", async () => {
    const input = new PassThrough();
    const output = new PassThrough();

    const close = vi.fn(() => {
      input.destroy();
      output.destroy();
    });

    const connection = connectStdio({ streams: { input, output, close } });

    const response = createClient(BootstrapService, connection.transport).getInfo(
      request,
      { timeoutMs: 2000 },
    );

    await delay(20);
    connection.close();

    expect(connection).not.toHaveProperty("child");
    expect(close).toHaveBeenCalledOnce();
    await expect(response).rejects.toThrow("unavailable");
  });
});
