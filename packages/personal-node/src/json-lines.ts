import { CliError } from "./errors";
import { parseJson, type JsonValue } from "./validation";

/** Bounded framing before JSON.parse, including split UTF-8 and partial lines. */
export class JsonLines {
  // Held as unmerged chunks until a newline actually arrives, so a stream of
  // many small chunks never pays for a full Buffer.concat on every push.
  private pending: Array<Buffer> = [];
  private pendingLength = 0;
  constructor(
    private readonly limit: number,
    private readonly receive: (value: JsonValue) => void,
  ) {}
  push(chunk: Buffer): void {
    this.pending.push(chunk);
    this.pendingLength += chunk.length;
    if (chunk.indexOf(10) < 0) {
      if (this.pendingLength > this.limit)
        throw new CliError(
          "protocol_limit",
          "Node protocol frame exceeds its byte limit.",
        );
      return;
    }
    let buffer = Buffer.concat(this.pending, this.pendingLength);
    for (;;) {
      const end = buffer.indexOf(10);
      if (end < 0) break;
      if (end > this.limit)
        throw new CliError(
          "protocol_limit",
          "Node protocol frame exceeds its byte limit.",
        );
      const line = buffer.subarray(0, end);
      buffer = buffer.subarray(end + 1);
      if (!line.length) continue;
      this.receive(this.frame(line));
    }
    if (buffer.length > this.limit)
      throw new CliError(
        "protocol_limit",
        "Node protocol frame exceeds its byte limit.",
      );
    this.pending = [buffer];
    this.pendingLength = buffer.length;
  }

  private frame(line: Buffer): JsonValue {
    try {
      return parseJson(new TextDecoder("utf-8", { fatal: true }).decode(line));
    } catch {
      throw new CliError("protocol_json", "Invalid UTF-8 JSON frame.");
    }
  }
}
