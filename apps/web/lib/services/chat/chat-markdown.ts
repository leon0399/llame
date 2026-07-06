import { STATIC_CHAT_MODELS } from "../../ai/models";
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

/** Display name for a model id (falls back to the raw id when unrecognized). */
function modelDisplayName(modelId: string): string {
  return (
    STATIC_CHAT_MODELS.find((model) => model.id === modelId)?.name ?? modelId
  );
}

function modelLabel(usage: unknown): string | undefined {
  if (typeof usage !== "object" || usage === null) return undefined;
  const model = (usage as { model?: unknown }).model;
  return typeof model === "string" ? modelDisplayName(model) : undefined;
}

/**
 * Render a chat's messages as portable Markdown. Only user/assistant turns with
 * content are included; system/tool rows and empty turns are skipped. The
 * assistant heading carries the model name (from `usage.model`); a reasoning part
 * becomes a blockquote. Pure, so it's unit-tested.
 */
export function chatToMarkdown(
  title: string,
  messages: ChatMessageResponse[],
): string {
  // Collapse newlines in the title so it can't break the `# ` heading.
  const blocks: string[] = [`# ${title.replace(/\s*\n+\s*/g, " ")}`];

  for (const message of messages) {
    if (message.role !== "user" && message.role !== "assistant") continue;
    const text = partsText(message.parts, "text");
    const reasoning = partsText(message.parts, "reasoning");
    if (!text && !reasoning) continue;

    const model =
      message.role === "assistant" ? modelLabel(message.usage) : undefined;
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
