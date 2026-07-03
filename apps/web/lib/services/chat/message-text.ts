/**
 * The concatenated text of a message's text parts — used to prefill the edit
 * editor from the message being edited. Non-text parts (tools, etc.) are ignored.
 * Pure, so it's unit-tested.
 */
export function userMessageText(
  parts: ReadonlyArray<{ type: string; text?: string }>,
): string {
  return parts
    .filter((part) => part.type === "text")
    .map((part) => part.text ?? "")
    .join("");
}
