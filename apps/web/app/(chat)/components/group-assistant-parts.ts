import type { UIMessage } from "ai";

/** A part the walk renders on its own — every part that is not reasoning. */
export type NonReasoningPart = Exclude<
  UIMessage["parts"][number],
  { type: "reasoning" }
>;

/** A run of consecutive reasoning parts, rendered as one Thinking panel. */
export type GroupedReasoning = {
  kind: "reasoning";
  /** The run's parts joined into one markdown body. */
  text: string;
  /** True while any part in the run is still streaming. */
  isStreaming: boolean;
  /** Index of the run's first part in the message's parts array. */
  startIndex: number;
};

export type GroupedPart = {
  kind: "part";
  part: NonReasoningPart;
  index: number;
};

export type GroupedAssistantPart = GroupedReasoning | GroupedPart;

/**
 * Collapse each run of consecutive reasoning parts into one block, so a
 * multi-summary thought is a single Thinking panel. A tool or visible text
 * part still splits groups — occurrence order stays intact, and reasoning is
 * never hoisted above a tool.
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
    if (part.type !== "reasoning") {
      grouped.push({ kind: "part", part, index });
      index += 1;
      continue;
    }

    const startIndex = index;
    const texts: Array<string> = [];
    let isStreaming = false;
    while (index < parts.length) {
      const current = parts[index];
      if (current === undefined || current.type !== "reasoning") {
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
