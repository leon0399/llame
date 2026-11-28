import { ChainOfThought } from "@workspace/ui/components/ai-elements/chain-of-thought";
import {
  Reasoning,
  ReasoningTrigger,
} from "@workspace/ui/components/ai-elements/reasoning";
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
  ToolIntent,
  toolIntent,
  type ToolHeaderState,
} from "@workspace/ui/components/ai-elements/tool";
import { latestReasoningHeading } from "@workspace/ui/lib/reasoning-blocks";
import {
  getToolName,
  isToolUIPart,
  type DynamicToolUIPart,
  type ToolUIPart,
  type UIMessage,
} from "ai";
import { z } from "zod";

import { dedicatedToolRow } from "./dedicated-tool-row";
import type { GroupedSteps, StepSegment } from "./group-assistant-parts";
import type { ChatMarkdownRenderers } from "../use-chat-markdown-ready";

// The steps of a reply: its thinking and its tool calls, as trace lines.
// Markdown/reasoning bodies come from `ChatMarkdownProvider` — never
// next/dynamic here (see `chat-message-row.tsx`).
const bashResult = z.object({ exitCode: z.number() });

function toolHeaderState(
  part: ToolUIPart | DynamicToolUIPart,
): ToolHeaderState {
  if (getToolName(part) === "bash" && part.state === "output-available") {
    const result = bashResult.safeParse(part.output);

    if (result.success && result.data.exitCode !== 0) return "output-error";
  }

  return part.state === "output-error" &&
    part.resultProviderMetadata?.llame?.cancelled === true
    ? "cancelled"
    : (part.state ?? "input-streaming");
}

/** A tool call/result part — its own component since a tool's header + output
 *  block carries real internal structure. */
function ToolPartView({ part }: { part: UIMessage["parts"][number] }) {
  if (!isToolUIPart(part)) return null;
  const toolName = getToolName(part);
  const toolState = toolHeaderState(part);

  return (
    <Tool>
      <ToolHeader
        type={`tool-${toolName}`}
        state={toolState}
        title={part.type === "dynamic-tool" ? toolName : undefined}
        intent={toolIntent(part)}
      />
      <ToolContent>
        <ToolInput input={part.input} />
        <ToolOutput
          output={part.output}
          errorText={part.errorText}
          state={
            toolState === "cancelled"
              ? "cancelled"
              : part.state === "output-error"
                ? "output-error"
                : undefined
          }
        />
      </ToolContent>
    </Tool>
  );
}

/** One Thinking panel for a run of consecutive reasoning parts: the run is a
 *  single visual thought until a tool or visible text part interrupts it.
 *  `ReasoningContent` repairs glued summary headings at display; the parts
 *  themselves keep the provider's exact text. */
function ReasoningPanel({
  text,
  isStreaming,
  renderers,
}: {
  text: string;
  isStreaming: boolean;
  renderers: ChatMarkdownRenderers;
}) {
  const ReasoningContent = renderers.ReasoningContent;

  return (
    <Reasoning isStreaming={isStreaming} title={latestReasoningHeading(text)}>
      <ReasoningTrigger />
      <ReasoningContent>{text}</ReasoningContent>
    </Reasoning>
  );
}

/** A tool call/result: its dedicated row, else the generic tool block. */
function ToolUIPartView({
  part,
  renderers,
}: {
  part: ToolUIPart | DynamicToolUIPart;
  renderers: ChatMarkdownRenderers;
}) {
  const row = dedicatedToolRow({
    toolName: getToolName(part),
    props: {
      input: part.input,
      output: part.output,
      errorText: part.errorText,
      state: toolHeaderState(part),
    },
    renderers,
  });

  return (
    <ToolIntent value={toolIntent(part)}>
      {row ?? <ToolPartView part={part} />}
    </ToolIntent>
  );
}

/** One step's trace line: a Thinking line or a tool call. */
function StepRow({
  step,
  renderers,
}: {
  step: StepSegment;
  renderers: ChatMarkdownRenderers;
}) {
  return step.kind === "reasoning" ? (
    <ReasoningPanel
      text={step.text}
      isStreaming={step.isStreaming}
      renderers={renderers}
    />
  ) : (
    <ToolUIPartView part={step.part} renderers={renderers} />
  );
}

/** A collapsed group keeps failed and cancelled outcomes visible. */
function stepsHeading(steps: ReadonlyArray<StepSegment>, running: boolean) {
  let failedCount = 0;
  let cancelledCount = 0;

  for (const step of steps) {
    if (step.kind !== "tool") continue;
    const state = toolHeaderState(step.part);

    if (state === "output-error") failedCount += 1;
    else if (state === "cancelled") cancelledCount += 1;
  }

  const failed = failedCount > 0;
  const cancelled = cancelledCount > 0;
  let title = running ? "Working" : `Worked through ${steps.length} steps`;

  if (failed) title += `, ${failedCount} failed`;

  if (cancelled) title += `, ${cancelledCount} cancelled`;

  return { title, failed, cancelled };
}

/** A run this long folds: up to three one-line steps say more than a summary
 *  of them does, and cost the transcript little. */
const FOLDED_STEPS_MIN = 4;

/**
 * A run of steps between two pieces of the answer. A few steps are their own
 * lines; a longer run folds into a group that stays open while the reply is
 * still producing it and collapses to its summary once the answer moves on, so
 * a turn's work takes one line of the transcript however long it ran.
 */
export function StepsBlock({
  block,
  running,
  renderKey,
  renderers,
}: {
  block: GroupedSteps;
  running: boolean;
  renderKey: string;
  renderers: ChatMarkdownRenderers;
}) {
  const rows = block.steps.map((step) => (
    <StepRow
      key={`message-part-${renderKey}-${
        step.kind === "reasoning" ? step.startIndex : step.index
      }`}
      step={step}
      renderers={renderers}
    />
  ));

  // One wrapper whatever the count, so the step that makes a run long enough
  // to fold does not remount the steps already showing.
  return (
    <ChainOfThought
      {...stepsHeading(block.steps, running)}
      running={running}
      folds={block.steps.length >= FOLDED_STEPS_MIN}
    >
      {rows}
    </ChainOfThought>
  );
}
