import { cutStringAtCodePointBoundary } from "@workspace/runtime-safety";
import type { BashExecutorContext } from "./types";

/**
 * The per-stream output bound (bash-execution "Command results are bounded and
 * explicit"). A Machine daemon bounds its streams in UTF-16 code units from
 * the protocol constant; the hub bounds them in UTF-8 bytes, because its bound
 * is `tools.artifacts.maxBytes` and a spilled part is stored at that size
 * (tool-result-artifacts D4).
 */
export type StreamBound = {
  readonly kind: "code-units" | "bytes";
  readonly limit: number;
};

/**
 * The bound one context applies. A byte bound wins, and a context with neither
 * has the zero limit that fails the managed boundary closed.
 */
export function streamOutputBound(context: BashExecutorContext): StreamBound {
  return context.outputBoundBytes === undefined
    ? { kind: "code-units", limit: context.outputBound ?? 0 }
    : { kind: "bytes", limit: context.outputBoundBytes };
}

/** The bound's measure of one string: code units or UTF-8 bytes. */
export function boundedLength(text: string, bound: StreamBound): number {
  return bound.kind === "bytes" ? Buffer.byteLength(text, "utf8") : text.length;
}

/**
 * Cut a string to the bound on a code-point boundary. A string within the
 * bound is returned as it is, so a caller can tell a cut by identity.
 */
export function cutToBound(text: string, bound: StreamBound): string {
  return bound.kind === "bytes"
    ? cutToUtf8Bytes(text, bound.limit)
    : cutStringAtCodePointBoundary(text, bound.limit);
}

/**
 * The UTF-8 prefix of `text` that fits `limit` bytes. Each code point is
 * measured as the UTF-8 length it encodes to, so a surrogate pair is kept or
 * dropped whole.
 */
function cutToUtf8Bytes(text: string, limit: number): string {
  let bytes = 0;
  let index = 0;
  while (index < text.length) {
    const code = text.codePointAt(index) ?? 0;
    bytes += utf8Width(code);
    if (bytes > limit) break;
    index += code > 0xff_ff ? 2 : 1;
  }
  return index === text.length ? text : text.slice(0, index);
}

function utf8Width(code: number): number {
  if (code <= 0x7f) return 1;
  if (code <= 0x7_ff) return 2;
  return code <= 0xff_ff ? 3 : 4;
}
