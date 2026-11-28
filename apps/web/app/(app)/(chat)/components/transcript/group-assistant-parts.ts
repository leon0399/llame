import {
  isToolUIPart,
  type DynamicToolUIPart,
  type ToolUIPart,
  type UIMessage,
} from "ai";

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

/** One step of the agent's work: a thought, or a tool call. */
export type StepSegment =
  | GroupedReasoning
  | { kind: "tool"; part: ToolUIPart | DynamicToolUIPart; index: number };

/** A run of consecutive steps, rendered as one trace. */
export type GroupedSteps = {
  kind: "steps";
  steps: Array<StepSegment>;
  /** Index of the run's first part in the message's parts array. */
  startIndex: number;
};

/** A part that is neither reasoning nor a tool call: text, or a notice. */
export type PlainPart = Exclude<
  NonReasoningPart,
  ToolUIPart | DynamicToolUIPart
>;

export type GroupedPlainPart = { kind: "part"; part: PlainPart; index: number };

/** What a reply paints, in order: a run of steps, or one other part. */
export type ReplyBlock = GroupedSteps | GroupedPlainPart;

/** The step a segment is, or null for text and notices. */
function workOf(segment: GroupedAssistantPart): StepSegment | null {
  if (segment.kind === "reasoning") return segment;

  if (!isToolUIPart(segment.part)) return null;

  return { kind: "tool", part: segment.part, index: segment.index };
}

/**
 * Fold each run of consecutive steps into one block, so the work between two
 * pieces of the answer reads as one trace instead of a stack of separate rows.
 * Text and notices still split runs, and occurrence order stays
 * intact. Pass only the segments that paint: a part that shows nothing must not
 * split a run.
 */
export function groupReplyBlocks(
  segments: ReadonlyArray<GroupedAssistantPart>,
): Array<ReplyBlock> {
  const blocks: Array<ReplyBlock> = [];

  for (const segment of segments) {
    const work = workOf(segment);
    const last = blocks.at(-1);

    if (work === null) {
      // `workOf` returned null, so this is a part, and not a tool call.
      if (segment.kind === "part" && !isToolUIPart(segment.part)) {
        blocks.push({ kind: "part", part: segment.part, index: segment.index });
      }
    } else if (last?.kind === "steps") {
      last.steps.push(work);
    } else {
      blocks.push({
        kind: "steps",
        steps: [work],
        startIndex: work.kind === "reasoning" ? work.startIndex : work.index,
      });
    }
  }

  return blocks;
}
