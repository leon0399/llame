import { modelDisplayName, type AvailableModel } from "../models/queries";
import type { ChatMessageResponse } from "./history";

type MaybePart = { type?: unknown; text?: unknown };

function partsText(parts: unknown, kind: "text" | "reasoning"): string {
  if (!Array.isArray(parts)) return "";
  return (
    parts
      .filter(
        (p): p is MaybePart =>
          typeof p === "object" && p !== null && (p as MaybePart).type === kind,
      )
      .map((p) => (typeof p.text === "string" ? p.text : ""))
      // Text parts around a tool call are distinct paragraphs in the UI — separate
      // them with a blank line so the export doesn't fuse two sentences.
      .join(kind === "reasoning" ? "\n" : "\n\n")
  );
}

function modelLabel(
  usage: unknown,
  models?: readonly AvailableModel[],
): string | undefined {
  if (typeof usage !== "object" || usage === null) return undefined;
  const modelId = (usage as { modelId?: unknown }).modelId;
  return typeof modelId === "string"
    ? modelDisplayName(modelId, models)
    : undefined;
}

/**
 * Render a chat's messages as portable Markdown. Only user/assistant turns with
 * content are included; system/tool rows and empty turns are skipped. The
 * assistant heading carries the model name (from `usage.modelId`); a reasoning part
 * becomes a blockquote. Pure, so it's unit-tested.
 */
export function chatToMarkdown(
  title: string,
  messages: ChatMessageResponse[],
  models?: readonly AvailableModel[],
): string {
  // Collapse newlines in the title so it can't break the `# ` heading.
  const blocks: string[] = [`# ${title.replace(/\s*\n+\s*/g, " ")}`];

  for (const message of messages) {
    if (message.role !== "user" && message.role !== "assistant") continue;
    const text = partsText(message.parts, "text");
    const reasoning = partsText(message.parts, "reasoning");
    if (!text && !reasoning) continue;

    const model =
      message.role === "assistant"
        ? modelLabel(message.usage, models)
        : undefined;
    const parts: string[] = [
      message.role === "user"
        ? "**You**"
        : `**Assistant**${model ? ` · ${model}` : ""}`,
    ];
    if (reasoning) {
      parts.push(`> _Reasoning:_ ${reasoning.replace(/\n/g, "\n> ")}`);
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
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "chat";
}
