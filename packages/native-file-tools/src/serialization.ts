import { isRecord } from "@workspace/runtime-safety";

/**
 * JSON text sent to the model for a native result, with source delimiters
 * escaped. An image result's display-only `thumbnail` is left out: it is
 * stored with the tool output for the owner's UI and never reaches a model
 * (vision-media D7).
 */
// eslint-disable-next-line anti-slop/no-unknown-parameters -- native output is already a JSON-shaped tool result at this boundary; JSON.stringify performs the shared serialization, including its toJSON and undefined handling.
export function serializeNativeModelOutput(value: unknown): string {
  const shown =
    isRecord(value) && value.kind === "image"
      ? { ...value, thumbnail: undefined }
      : value;
  const json = JSON.stringify(shown ?? null) ?? "null";
  return json
    .replaceAll("<", String.raw`\u003c`)
    .replaceAll(">", String.raw`\u003e`);
}

// eslint-disable-next-line anti-slop/no-unknown-parameters -- delegates to the shared serializer above; its input remains the arbitrary native result shape accepted at the model boundary.
export function measureNativeModelOutput(value: unknown): number {
  return serializeNativeModelOutput(value).length;
}
