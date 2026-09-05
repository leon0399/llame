import { normalizeProtectedValues, redactProtectedString, sanitizeProtectedValueJson } from '@workspace/runtime-safety';
import { type RuntimeOutput, type VisibleEvent } from './output';

/** Redact before the protocol, not only when the terminal renders. */
export class NodeOutput implements RuntimeOutput {
  private values: readonly string[] = [];
  constructor(private readonly send: (kind: string, value: unknown) => void) {}
  protect(values: readonly string[]): void { this.values = normalizeProtectedValues([...this.values, ...values]); }
  private safe(value: unknown): unknown {
    const result = sanitizeProtectedValueJson(value, this.values);
    return result.success ? result.value : { withheld: true, reason: 'protected_value_key' };
  }
  event(event: VisibleEvent): void { this.send('event', this.safe(event)); }
  text(value: string): void { this.send('text', redactProtectedString(value, this.values)); }
  notice(value: string): void { this.send('notice', redactProtectedString(value, this.values)); }
}
