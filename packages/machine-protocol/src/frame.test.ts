import { describe, expect, it } from "vitest";
import {
  decodeFrame,
  encodeFrame,
  FrameSizeError,
  toJsonRpcMessage,
  MAX_FRAME_BYTES,
  MAX_MESSAGE_BYTES,
} from "./index";
import { createLineFramer } from "./framer";

const id = 1;

/** A success message padded so its serialized form is exactly `byteSize`. */
function paddedResult(byteSize: number): string {
  const shell = JSON.stringify({ jsonrpc: "2.0", id, result: "" });
  return "x".repeat(byteSize - Buffer.byteLength(shell, "utf8"));
}

describe("frame encoding", () => {
  it("round-trips every message shape", () => {
    const messages = [
      { jsonrpc: "2.0", id, method: "fs.stat", params: { path: "/srv" } },
      { jsonrpc: "2.0", method: "ping" },
      { jsonrpc: "2.0", id, result: { status: "success" } },
      {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32_001, message: "no", data: { code: "internal" } },
      },
    ] as const;
    for (const message of messages) {
      const line = encodeFrame({ s: 3, m: message });
      expect(decodeFrame(line)).toEqual({
        ok: true,
        frame: { s: 3, m: message },
      });
    }
  });

  it("accepts a message at the byte bound and refuses one above it", () => {
    const shell = JSON.stringify({ jsonrpc: "2.0", id, result: "" });
    const overhead = Buffer.byteLength(shell, "utf8");
    const atBound = encodeFrame({
      s: 1,
      m: { jsonrpc: "2.0", id, result: paddedResult(MAX_MESSAGE_BYTES) },
    });
    expect(atBound.length).toBeLessThan(MAX_FRAME_BYTES);
    expect(decodeFrame(atBound).ok).toBe(true);
    expect(() =>
      encodeFrame({
        s: 1,
        m: {
          jsonrpc: "2.0",
          id,
          result: paddedResult(MAX_MESSAGE_BYTES + 1),
        },
      }),
    ).toThrow(FrameSizeError);
    expect(overhead).toBeGreaterThan(0);
  });

  it("reports an oversize message with the stream it named", () => {
    const line = `{"s":7,"m":{"jsonrpc":"2.0","id":1,"result":"${paddedResult(MAX_MESSAGE_BYTES + 1)}"}}\n`;
    expect(decodeFrame(line)).toEqual({
      ok: false,
      reason: "oversize",
      streamId: 7,
    });
  });
});

describe("frame decoding", () => {
  it("refuses anything that is not a message on a stream", () => {
    const malformed = [
      "",
      "not json",
      "[]",
      "3",
      '{"s":1}',
      '{"s":-1,"m":{"jsonrpc":"2.0","method":"ping"}}',
      '{"s":1.5,"m":{"jsonrpc":"2.0","method":"ping"}}',
      '{"s":"1","m":{"jsonrpc":"2.0","method":"ping"}}',
      '{"s":1,"m":{"jsonrpc":"1.0","method":"ping"}}',
      '{"s":1,"m":{"jsonrpc":"2.0"}}',
      '{"s":1,"m":{"jsonrpc":"2.0","id":true,"method":"ping"}}',
      '{"s":1,"m":{"jsonrpc":"2.0","id":1,"error":{"code":"x","message":"y"}}}',
      '{"s":1,"m":{"jsonrpc":"2.0","id":1,"error":{"code":1,"message":2}}}',
      '{"s":1,"m":{"jsonrpc":"2.0","id":1,"result":null,"method":"ping"}}',
    ];
    for (const line of malformed)
      expect(decodeFrame(line)).toMatchObject({
        ok: false,
        reason: "malformed",
      });
  });

  it("decodes an error with a null id and drops absent params", () => {
    expect(
      toJsonRpcMessage({
        jsonrpc: "2.0",
        id: null,
        error: { code: -1, message: "no" },
      }),
    ).toEqual({
      jsonrpc: "2.0",
      id: null,
      error: { code: -1, message: "no" },
    });
    expect(toJsonRpcMessage({ jsonrpc: "2.0", method: "ping" })).toEqual({
      jsonrpc: "2.0",
      method: "ping",
    });
  });
});

describe("line framer", () => {
  it("reassembles frames split across chunks and multi-byte characters", () => {
    const framer = createLineFramer();
    const text = '{"a":"ünïcødé"}\n{"b":2}\n';
    const bytes = Buffer.from(text, "utf8");
    const split = bytes.indexOf(Buffer.from("ü", "utf8")) + 1;
    expect(framer.push(bytes.subarray(0, split))).toEqual([]);
    expect(framer.push(bytes.subarray(split))).toEqual([
      { kind: "line", line: '{"a":"ünïcødé"}' },
      { kind: "line", line: '{"b":2}' },
    ]);
  });

  it("reports one oversize line and resumes after its newline", () => {
    const framer = createLineFramer(16);
    expect(framer.push(`${"y".repeat(17)}\n{"ok":1}\n`)).toEqual([
      { kind: "oversize" },
      { kind: "line", line: '{"ok":1}' },
    ]);
  });

  it("skips an endless line without buffering past the bound", () => {
    const framer = createLineFramer(16);
    expect(framer.push("z".repeat(20))).toEqual([{ kind: "oversize" }]);
    expect(framer.push("still the same line\n")).toEqual([]);
    expect(framer.push("next\n")).toEqual([{ kind: "line", line: "next" }]);
  });
});
