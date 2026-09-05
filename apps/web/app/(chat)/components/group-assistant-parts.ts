import type { UIMessage } from "ai";

export type GroupedReasoning = {
  kind: "reasoning";
  text: string;
  isStreaming: boolean;
  startIndex: number;
};

export type GroupedPart = {
  kind: "part";
  part: UIMessage["parts"][number];
  index: number;
};

export type GroupedAssistantPart = GroupedReasoning | GroupedPart;

function isReasoningPart(
  part: UIMessage["parts"][number],
): part is Extract<UIMessage["parts"][number], { type: "reasoning" }> {
  return part.type === "reasoning";
}

/**
 * Collapse adjacent reasoning parts into one block so each contiguous
 * summary run is a single Thinking panel. A tool or text part still splits
 * groups — occurrence order stays intact.
 */
export function groupAssistantParts(
  parts: UIMessage["parts"],
): Array<GroupedAssistantPart> {
  const grouped: Array<GroupedAssistantPart> = [];
  let index = 0;

  while (index < parts.length) {
    const part = parts[index];
    if (part === undefined) {
      break;
    }
    if (!isReasoningPart(part)) {
      grouped.push({ kind: "part", part, index });
      index += 1;
      continue;
    }

    const startIndex = index;
    const texts: Array<string> = [];
    let isStreaming = false;
    while (index < parts.length) {
      const current = parts[index];
      if (current === undefined || !isReasoningPart(current)) {
        break;
      }
      texts.push(current.text);
      if (current.state === "streaming") {
        isStreaming = true;
      }
      index += 1;
    }
    grouped.push({
      kind: "reasoning",
      text: texts.join("\n\n"),
      isStreaming,
      startIndex,
    });
  }

  return grouped;
}
