import { mkdir, appendFile, readFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { ModelMessage } from "ai";

import { isRecord } from "./unknown-record";
import { type RunEvent } from "./run";

/**
 * One durable entry in a session. The log is the single source of model
 * context: everything the next turn's model will see was appended here
 * first ("model-visible means logged"). Run events ride along for the
 * owner-side audit trail; only the `user_prompt` and `assistant_messages`
 * entries are projected back into model context.
 */
export type SessionEvent =
  | { type: "user_prompt"; text: string }
  | { type: "run_event"; event: RunEvent }
  | { type: "assistant_messages"; messages: ModelMessage[] };

export interface SessionEntry {
  readonly seq: number;
  readonly timestamp: string;
  readonly event: SessionEvent;
}

function parseLine(line: string): SessionEntry | undefined {
  try {
    const value = JSON.parse(line) as unknown;
    if (
      isRecord(value) &&
      typeof value.seq === "number" &&
      typeof value.timestamp === "string" &&
      isRecord(value.event) &&
      typeof value.event.type === "string"
    ) {
      return {
        seq: value.seq,
        timestamp: value.timestamp,
        event: value.event as unknown as SessionEvent,
      };
    }
  } catch {
    // A torn trailing line (crash mid-append) reads as absent.
  }
  return undefined;
}

/**
 * Append-only JSONL session log. Reads project the whole file every time —
 * sessions are small, and "current lines are authoritative" needs no cache.
 */
export class SessionLog {
  private constructor(
    private readonly filePath: string,
    private readonly entries: SessionEntry[],
    private nextSeq: number,
  ) {}

  static async open(filePath: string): Promise<SessionLog> {
    let raw = "";
    try {
      raw = await readFile(filePath, "utf8");
    } catch {
      raw = "";
    }
    const parsed = raw
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map(parseLine)
      .filter((entry) => entry !== undefined);
    const nextSeq =
      parsed.reduce((max, entry) => Math.max(max, entry.seq), 0) + 1;
    return new SessionLog(filePath, parsed, nextSeq);
  }

  async append(event: SessionEvent): Promise<SessionEntry> {
    const entry: SessionEntry = {
      seq: this.nextSeq,
      timestamp: new Date().toISOString(),
      event,
    };
    await mkdir(dirname(this.filePath), { recursive: true });
    await appendFile(this.filePath, `${JSON.stringify(entry)}\n`, "utf8");
    this.entries.push(entry);
    this.nextSeq += 1;
    return entry;
  }

  all(): readonly SessionEntry[] {
    return this.entries;
  }

  /**
   * Project the log into model context: user prompts and assistant response
   * messages in log order. Run events never enter the projection — they are
   * narration for the owner, not conversation.
   */
  deriveMessages(): ModelMessage[] {
    const messages: ModelMessage[] = [];
    for (const { event } of this.entries) {
      if (event.type === "user_prompt") {
        messages.push({ role: "user", content: event.text });
      } else if (event.type === "assistant_messages") {
        messages.push(...event.messages);
      }
    }
    return messages;
  }
}
