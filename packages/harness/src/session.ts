import { mkdir, appendFile, readFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { ModelMessage } from "ai";

import { type RunEvent } from "./run";
import {
  isNumber,
  isRecord,
  isString,
  type UnknownRecord,
} from "./unknown-record";

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

/**
 * A read-back entry. The event is only known to be a record: lines are
 * re-validated structurally on read, so a hand-edited or foreign line can
 * never smuggle a malformed message into the projection.
 */
export interface SessionEntry {
  readonly seq: number;
  readonly timestamp: string;
  readonly event: UnknownRecord;
}

/** A model message as projected back out of the log. */
function isModelMessage(value: unknown): value is ModelMessage {
  if (!isRecord(value) || !isString(value.role)) {
    return false;
  }
  const { content } = value;
  // Content is either a plain string or an SDK part array; both shapes are
  // only ever WRITTEN here by append(), straight from AI SDK responses.
  return isString(content) || Array.isArray(content);
}

function parseLine(line: string): SessionEntry | undefined {
  try {
    // SAFETY: the result is immediately narrowed by isRecord/isNumber/isString
    // guards below; anything failing them reads as an absent line.
    const value = JSON.parse(line) as unknown;
    if (
      isRecord(value) &&
      isNumber(value.seq) &&
      isString(value.timestamp) &&
      isRecord(value.event) &&
      isString(value.event.type)
    ) {
      return {
        seq: value.seq,
        timestamp: value.timestamp,
        event: value.event,
      };
    }
  } catch {
    // A torn trailing line (crash mid-append) reads as absent.
  }
  return undefined;
}

function toModelMessages(event: UnknownRecord): ModelMessage[] {
  if (event.type === "user_prompt" && isString(event.text)) {
    return [{ role: "user", content: event.text }];
  }
  if (
    event.type === "assistant_messages" &&
    Array.isArray(event.messages) &&
    event.messages.every(isModelMessage)
  ) {
    return event.messages;
  }
  return [];
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
    // Claim the sequence number synchronously: concurrent appends (the run
    // loop tees events fire-and-forget while the caller awaits the outcome)
    // must never observe the same seq across the first await boundary.
    const seq = this.nextSeq++;
    const entry: SessionEntry = {
      seq,
      timestamp: new Date().toISOString(),
      event,
    };
    await mkdir(dirname(this.filePath), { recursive: true });
    await appendFile(this.filePath, `${JSON.stringify(entry)}\n`, "utf8");
    this.entries.push(entry);
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
      messages.push(...toModelMessages(event));
    }
    return messages;
  }
}
