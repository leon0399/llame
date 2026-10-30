import { isRecord } from "./unknown-record";

/**
 * The part of a tool result a model may receive (tool-result-rendering
 * "Display data is stored and never rendered").
 *
 * A result may carry a `display` object: data the owner's UI renders and the
 * model never sees. The stored part keeps it as the tool wrote it; every
 * rendering drops it here.
 *
 * An image result stored before `display.thumbnail` existed carries the
 * thumbnail at its top level instead. That legacy shape is dropped too, so
 * "a thumbnail never reaches the model" holds for old and new parts. The
 * removal is keyed on `kind === "image"` — on any other result a top-level
 * `thumbnail` is ordinary payload.
 *
 * A non-record passes through unchanged; only records carry either key.
 */
export function modelVisibleResult(value: unknown) {
  if (!isRecord(value)) return value;
  const hidesDisplay = Object.hasOwn(value, "display");
  const hidesLegacyThumbnail =
    value.kind === "image" && Object.hasOwn(value, "thumbnail");
  if (!hidesDisplay && !hidesLegacyThumbnail) return value;
  const { display: _display, thumbnail: _thumbnail, ...visible } = value;
  return visible;
}
