import { normalizeProtectedValues } from '@workspace/runtime-safety';
import { codePointSafeCutIndex } from '@workspace/runtime-safety';

/** Remove terminal commands and bidi controls even across arbitrary chunks. */
export function terminalText(value: string): string {
  return value.replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g, '');
}

/** Delays incomplete secret prefixes, preventing split-delta credential leaks. */
export class SecretStream {
  private pending = '';
  private readonly secrets: readonly string[];

  constructor(values: readonly string[]) { this.secrets = normalizeProtectedValues(values); }

  hasPending(): boolean { return this.pending.length > 0; }

  push(delta: string, final = false): string {
    this.pending += delta;
    let output = '';
    while (this.pending.length) {
      const possible = this.secrets.find((secret) => secret.startsWith(this.pending));
      if (!final && possible && possible.length > this.pending.length) break;
      const match = this.secrets.find((secret) => this.pending.startsWith(secret));
      if (match) {
        output += '[REDACTED]';
        this.pending = this.pending.slice(match.length);
      } else {
        const point = this.pending.codePointAt(0);
        const width = point !== undefined && point > 0xffff ? 2 : 1;
        if (!final && width === 1 && /[\ud800-\udbff]/.test(this.pending[0]!) && this.pending.length === 1) break;
        output += this.pending.slice(0, width);
        this.pending = this.pending.slice(width);
      }
    }
    return output;
  }
}

export interface VisibleEvent {
  readonly eventType: string;
  readonly payload: unknown;
  readonly runId?: string;
  readonly chatId?: string;
  readonly sequence?: number;
}

export interface RuntimeOutput {
  protect(values: readonly string[]): void;
  event(event: VisibleEvent): void;
  text(value: string): void;
  notice(value: string): void;
}

export function boundedText(value: string, max: number): string {
  return value.slice(0, codePointSafeCutIndex(value, max));
}
