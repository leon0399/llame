import { StringDecoder } from "node:string_decoder";
import { MAX_FRAME_BYTES } from "./constants";

/** What the framer found in one push: a complete line, or a line that grew
 *  past the frame bound and was discarded unparsed. */
export type FramerEvent =
  | { readonly kind: "line"; readonly line: string }
  | { readonly kind: "oversize" };

export type LineFramer = {
  /** Feed one chunk; the complete events come back in stream order. */
  push(chunk: string | Buffer): Array<FramerEvent>;
};

/**
 * Splits a byte stream into newline-delimited frames. UTF-8 sequences split
 * across chunks are held until complete, and a line that reaches the frame
 * bound without a terminator is reported once and then skipped to its
 * newline, so neither a huge frame nor an endless one is buffered.
 */
export function createLineFramer(
  maxLineBytes: number = MAX_FRAME_BYTES,
): LineFramer {
  const decoder = new StringDecoder("utf8");
  let pending = "";
  let pendingBytes = 0;
  let skipping = false;

  return {
    push(chunk: string | Buffer): Array<FramerEvent> {
      const text = Buffer.isBuffer(chunk) ? decoder.write(chunk) : chunk;
      const events: Array<FramerEvent> = [];
      let rest = text;
      while (rest.length > 0) {
        const at = rest.indexOf("\n");
        const terminated = at !== -1;
        const body = terminated ? rest.slice(0, at) : rest;
        rest = terminated ? rest.slice(at + 1) : "";
        if (skipping) {
          if (terminated) skipping = false;
          continue;
        }
        pending += body;
        pendingBytes += Buffer.byteLength(body, "utf8");
        if (pendingBytes > maxLineBytes) {
          pending = "";
          pendingBytes = 0;
          skipping = !terminated;
          events.push({ kind: "oversize" });
          continue;
        }
        if (!terminated) continue;
        events.push({ kind: "line", line: pending });
        pending = "";
        pendingBytes = 0;
      }
      return events;
    },
  };
}
