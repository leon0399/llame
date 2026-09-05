import { normalizeProtectedValues, redactProtectedString, sanitizeProtectedValueJson } from '@workspace/runtime-safety';
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

export class Output {
  private values: readonly string[] = [];
  constructor(readonly json: boolean) {}
  protect(values: readonly string[]): void { this.values = normalizeProtectedValues([...this.values, ...values]); }
  safe(value: string): string { return redactProtectedString(value, this.values); }
  private structured(value: unknown): unknown {
    const result = sanitizeProtectedValueJson(value, this.values);
    return result.success ? result.value : { withheld: true, reason: 'protected_value_key' };
  }
  event(event: VisibleEvent): void {
    if (this.json) process.stdout.write(JSON.stringify(this.structured(event)) + '\n');
  }
  text(value: string): void {
    if (!this.json) process.stdout.write(terminalText(this.safe(value)));
  }
  notice(value: string): void { process.stderr.write(terminalText(this.safe(value)) + '\n'); }
  value(value: unknown): void {
    const rendered = JSON.stringify(this.structured(value), null, this.json ? undefined : 2);
    process.stdout.write((this.json ? rendered : terminalText(rendered)) + '\n');
  }
}

export function boundedText(value: string, max: number): string {
  return value.slice(0, codePointSafeCutIndex(value, max));
}
