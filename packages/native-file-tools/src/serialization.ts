import {
  modelVisibleResult,
  neutralizeReservedDelimitersDeep,
} from "@workspace/runtime-safety";

/**
 * JSON text sent to the model for a native result: the result as the model may
 * see it — no `display` partition, no legacy top-level image `thumbnail` — with
 * every reserved delimiter escaped by the one reserved-name rule
 * (tool-result-rendering "Tool result payloads are neutralized by the
 * reserved-name rule"). No other character is touched: source markup a read
 * carries is the content the model asked for.
 */
// eslint-disable-next-line anti-slop/no-unknown-parameters -- native output is already a JSON-shaped tool result at this boundary; JSON.stringify performs the shared serialization, including its toJSON and undefined handling.
export function serializeNativeModelOutput(value: unknown): string {
  const visible = neutralizeReservedDelimitersDeep(modelVisibleResult(value));
  return JSON.stringify(visible ?? null) ?? "null";
}

// eslint-disable-next-line anti-slop/no-unknown-parameters -- delegates to the shared serializer above; its input remains the arbitrary native result shape accepted at the model boundary.
export function measureNativeModelOutput(value: unknown): number {
  return serializeNativeModelOutput(value).length;
}
