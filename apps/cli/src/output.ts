import { normalizeProtectedValues, redactProtectedString, sanitizeProtectedValueJson } from '@workspace/runtime-safety';
import { terminalText, type VisibleEvent, type RuntimeOutput } from '@workspace/personal-node/output';

export class Output implements RuntimeOutput {
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

