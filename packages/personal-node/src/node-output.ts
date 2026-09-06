import {
  normalizeProtectedValues,
  redactProtectedString,
  sanitizeProtectedValueJson,
} from "@workspace/runtime-safety";
import { type RuntimeOutput, type VisibleEvent } from "./output";
import { jsonValue, type JsonValue } from "./validation";

/** Redact before the protocol, not only when the terminal renders. */
export class NodeOutput implements RuntimeOutput {
  private values: ReadonlyArray<string> = [];
  constructor(
    private readonly send: (kind: string, value: JsonValue) => void,
  ) {}
  protect(values: ReadonlyArray<string>): void {
    this.values = normalizeProtectedValues([...this.values, ...values]);
  }
  private safe(event: VisibleEvent): JsonValue {
    const result = sanitizeProtectedValueJson(event, this.values);
    return result.success
      ? jsonValue(result.value)
      : { withheld: true, reason: "protected_value_key" };
  }
  event(event: VisibleEvent): void {
    this.send("event", this.safe(event));
  }
  text(value: string): void {
    this.send("text", redactProtectedString(value, this.values));
  }
  notice(value: string): void {
    this.send("notice", redactProtectedString(value, this.values));
  }
}
