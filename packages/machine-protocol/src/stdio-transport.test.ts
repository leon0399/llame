import { PassThrough } from "node:stream";
import { ConnectError, createClient } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";
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

    const response = createClient(
      BootstrapService,
      connection.transport,
    ).getInfo(request, { timeoutMs: 200 });

    await vi.waitFor(() => expect(stderr).toHaveBeenCalledWith("ready\n"));
    expect(connection.child).toBeDefined();
    connection.close();

    await expect(response).rejects.toBeInstanceOf(ConnectError);
  });

  it("wraps existing streams and invokes their close hook", () => {
    const input = new PassThrough();
    const output = new PassThrough();

    const close = vi.fn();

    const connection = connectStdio({ streams: { input, output, close } });

    expect(connection.transport).toBeDefined();
    expect(connection).not.toHaveProperty("child");

    connection.close();

    expect(close).toHaveBeenCalledOnce();

    input.end();
    output.end();
  });
});
