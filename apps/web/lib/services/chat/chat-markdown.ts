import { modelDisplayName, type AvailableModel } from "../models/queries";
import type { ChatMessageResponse } from "./history";

type MaybePart = { type?: unknown; text?: unknown };

function isNonNullObject(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function partsText(parts: unknown, kind: "text" | "reasoning"): string {
  if (!Array.isArray(parts)) return "";
  return (
    parts
      .filter((p): p is MaybePart => {
        if (!isNonNullObject(p)) return false;
        // SAFETY: `isNonNullObject` above confirmed `p` is a non-null
        // object; `MaybePart`'s fields are optional and `unknown`-typed, so
        // this only unlocks property access — it asserts no value type.
        return (p as MaybePart).type === kind;
      })
      .map((p) => (isString(p.text) ? p.text : ""))
      // Text parts around a tool call are distinct paragraphs in the UI — separate
      // them with a blank line so the export doesn't fuse two sentences.
      .join(kind === "reasoning" ? "\n" : "\n\n")
  );
}

function modelLabel(
  usage: unknown,
  models?: ReadonlyArray<AvailableModel>,
): string | undefined {
  if (!isNonNullObject(usage)) return undefined;
  // SAFETY: `isNonNullObject` above confirmed `usage` is a non-null object;
  // `modelId` is read here still unvalidated and checked next.
  const modelId = (usage as { modelId?: unknown }).modelId;
  return isString(modelId) ? modelDisplayName(modelId, models) : undefined;
}

/**
 * Render a chat's messages as portable Markdown. Only user/assistant turns with
 * content are included; system/tool rows, model/availability semantic controls,
 * and empty turns are skipped. The
 * assistant heading carries the model name (from `usage.modelId`); a reasoning part
 * becomes a blockquote. Pure, so it's unit-tested.
 */
export function chatToMarkdown(
  title: string,
  messages: Array<ChatMessageResponse>,
  models?: ReadonlyArray<AvailableModel>,
): string {
  // Collapse newlines in the title so it can't break the `# ` heading.
  const blocks: Array<string> = [`# ${title.replaceAll(/\s*\n+\s*/g, " ")}`];

  for (const message of messages) {
    if (message.role !== "user" && message.role !== "assistant") continue;
    const text = partsText(message.parts, "text");
    const reasoning = partsText(message.parts, "reasoning");
    if (!text && !reasoning) continue;

    const model =
      message.role === "assistant"
        ? modelLabel(message.usage, models)
        : undefined;
    const parts: Array<string> = [
      message.role === "user"
        ? "**You**"
        : `**Assistant**${model ? ` · ${model}` : ""}`,
    ];
    if (reasoning) {
      parts.push(`> _Reasoning:_ ${reasoning.replaceAll("\n", "\n> ")}`);
    }
    if (text) parts.push(text);
    blocks.push(parts.join("\n\n"));
  }

  return blocks.join("\n\n---\n\n") + "\n";
}

/** A filename-safe slug for a chat title (fallback "chat"). */
export function slugifyTitle(title: string): string {
  const slug = title
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "");
  return slug || "chat";
}
