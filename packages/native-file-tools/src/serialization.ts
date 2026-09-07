/** JSON text sent to the model for a native result, with source delimiters escaped. */
// eslint-disable-next-line anti-slop/no-unknown-parameters -- native output is already a JSON-shaped tool result at this boundary; JSON.stringify performs the shared serialization, including its toJSON and undefined handling.
export function serializeNativeModelOutput(value: unknown): string {
  const json = JSON.stringify(value ?? null) ?? "null";
  return json
    .replaceAll("<", String.raw`\u003c`)
    .replaceAll(">", String.raw`\u003e`);
}

// eslint-disable-next-line anti-slop/no-unknown-parameters -- delegates to the shared serializer above; its input remains the arbitrary native result shape accepted at the model boundary.
export function measureNativeModelOutput(value: unknown): number {
  return serializeNativeModelOutput(value).length;
}
