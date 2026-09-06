import { normalizeProtectedValues } from "@workspace/runtime-safety";
import { codePointSafeCutIndex } from "@workspace/runtime-safety";
import { type JsonValue } from "./validation";

/** Remove terminal commands and bidi controls even across arbitrary chunks. */
export function terminalText(value: string): string {
  return value.replaceAll(controlChars(), "");
}

/** Delays incomplete secret prefixes, preventing split-delta credential leaks. */
export class SecretStream {
  private pending = "";
  private readonly secrets: ReadonlyArray<string>;

  constructor(values: ReadonlyArray<string>) {
    this.secrets = normalizeProtectedValues(values);
  }

  hasPending(): boolean {
    return this.pending.length > 0;
  }

  push(delta: string, final = false): string {
    this.pending += delta;
    let output = "";
    while (this.pending.length) {
      const possible = this.secrets.find((secret) =>
        secret.startsWith(this.pending),
      );
      if (!final && possible && possible.length > this.pending.length) break;
      const match = this.secrets.find((secret) =>
        this.pending.startsWith(secret),
      );
      if (match) {
        output += "[REDACTED]";
        this.pending = this.pending.slice(match.length);
      } else {
        const point = this.pending.codePointAt(0);
        const width = point !== undefined && point > 0xff_ff ? 2 : 1;
        if (
          !final &&
          width === 1 &&
          /[\ud800-\udbff]/.test(this.pending[0]!) &&
          this.pending.length === 1
        )
          break;
        output += this.pending.slice(0, width);
        this.pending = this.pending.slice(width);
      }
    }
    return output;
  }
}

export interface VisibleEvent {
  readonly eventType: string;
  readonly payload: JsonValue;
  readonly runId?: string;
  readonly chatId?: string;
  readonly sequence?: number;
}

export interface RuntimeOutput {
  protect(values: ReadonlyArray<string>): void;
  event(event: VisibleEvent): void;
  text(value: string): void;
  notice(value: string): void;
}

function hexCode(value: number): string {
  return value.toString(16).padStart(4, "0");
}

function unicodeRange(start: number, end: number): string {
  return String.raw`\u${hexCode(start)}-\u${hexCode(end)}`;
}

function controlChars(): RegExp {
  return new RegExp(
    `[${unicodeRange(0, 8)}${unicodeRange(11, 31)}${unicodeRange(127, 159)}${String.raw`\u061c\u200e\u200f`}${unicodeRange(0x20_2a, 0x20_2e)}${unicodeRange(0x20_66, 0x20_69)}]`,
    "g",
  );
}

export function boundedText(value: string, max: number): string {
  return value.slice(0, codePointSafeCutIndex(value, max));
}
