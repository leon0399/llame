import {
  isBoolean,
  isNumber,
  isRecord,
  isString,
  normalizeProtectedValues,
  redactProtectedString,
  sanitizeProtectedValueJson,
} from "@workspace/runtime-safety";
import { CliError } from "@workspace/personal-node/errors";
import { type JsonValue } from "@workspace/personal-node/validation";
import {
  terminalText,
  type VisibleEvent,
  type RuntimeOutput,
} from "@workspace/personal-node/output";

export type DisplayValue = JsonValue;

export function displayValue(value: unknown): DisplayValue {
  if (isString(value)) return value;
  if (isNumber(value)) return value;
  if (isBoolean(value)) return value;
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(displayValue);
  if (isRecord(value)) return value;
  throw new CliError("invalid_data", "Value must be JSON.");
}

export class Output implements RuntimeOutput {
  private values: ReadonlyArray<string> = [];
  constructor(readonly json: boolean) {}
  protect(values: ReadonlyArray<string>): void {
    this.values = normalizeProtectedValues([...this.values, ...values]);
  }
  safe(value: string): string {
    return redactProtectedString(value, this.values);
  }
  private structured(value: DisplayValue): DisplayValue {
    const result = sanitizeProtectedValueJson(value, this.values);
    if (!result.success)
      return { withheld: true, reason: "protected_value_key" };
    return displayValue(result.value);
  }
  event(event: VisibleEvent): void {
    if (this.json)
      process.stdout.write(
        JSON.stringify(this.structured(displayValue(event))) + "\n",
      );
  }
  text(value: string): void {
    if (!this.json) process.stdout.write(terminalText(this.safe(value)));
  }
  notice(value: string): void {
    process.stderr.write(terminalText(this.safe(value)) + "\n");
  }
  value(value: DisplayValue): void {
    const rendered = JSON.stringify(
      this.structured(value),
      null,
      this.json ? undefined : 2,
    );
    process.stdout.write(
      (this.json ? rendered : terminalText(rendered)) + "\n",
    );
  }
}
