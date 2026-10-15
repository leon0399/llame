// @vitest-environment jsdom

/**
 * Container exception (testing rule 5): quantitative harness for stream-tick
 * reconcile cost on a fat tool list, not a component-behavior assertion. It
 * mounts the shared Tool chrome the transcript uses and counts React commits
 * under stable vs unstable message identity (pre-/post-fix merge contract).
 */

import { cleanup, render } from "@testing-library/react";
import type { UIMessage } from "ai";
import { memo } from "react";
import { afterEach, describe, expect, it } from "vitest";

import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from "@workspace/ui/components/ai-elements/tool";

import { mergeTrustedModelContextParts } from "@/lib/services/chat/history";

const TOOL_COUNT = 87;
const STREAM_TICKS = 50;

type ToolFixturePart = UIMessage["parts"][number] & {
  type: `tool-${string}`;
  state: "output-available";
  input: unknown;
  output: unknown;
  errorText?: string;
};

function isToolPart(part: UIMessage["parts"][number]): part is ToolFixturePart {
  return part.type.startsWith("tool-");
}

function fatAssistantMessage(id: string): UIMessage {
  const parts: Array<UIMessage["parts"][number]> = [];
  for (let i = 0; i < TOOL_COUNT; i += 1) {
    // SAFETY: vitest fixture — reasoning shape the Tool chrome skips and the
    // merge leaves untouched; the SDK part union is wider than this literal.
    const reasoningPart = {
      type: "reasoning",
      text: `step ${i}`,
      state: "done",
    } as UIMessage["parts"][number];
    // SAFETY: vitest fixture — tool-bash shape ToolHeader/Input/Output read;
    // the SDK part union is wider than this literal.
    const toolPart = {
      type: "tool-bash",
      toolCallId: `call-${i}`,
      state: "output-available",
      input: { command: `echo ${i}` },
      output: `ok-${i}`,
    } as UIMessage["parts"][number];
    parts.push(reasoningPart, toolPart);
  }
  parts.push({ type: "text", text: "Done." });
  return { id, role: "assistant", parts };
}

function ToolChrome({ parts }: { parts: UIMessage["parts"] }) {
  return (
    <>
      {parts.map((part, index) => {
        if (!isToolPart(part)) return null;
        return (
          <Tool key={`tool-${index}`}>
            <ToolHeader type={part.type} state={part.state} />
            <ToolContent>
              <ToolInput input={part.input} />
              <ToolOutput output={part.output} errorText={part.errorText} />
            </ToolContent>
          </Tool>
        );
      })}
    </>
  );
}

const MemoToolChrome = memo(ToolChrome);

type IdleTurnProps = {
  message: UIMessage;
  onCommit: () => void;
};

const IdleTurn = memo(function IdleTurn({ message, onCommit }: IdleTurnProps) {
  onCommit();
  return <MemoToolChrome parts={message.parts} />;
});

type TickCost = {
  commitsDuringTicks: number;
  mountMs: number;
  tickMs: number;
};

afterEach(() => {
  cleanup();
});

describe("chat transcript stream-tick cost (perf)", () => {
  // 87 tool rows × 50 unstable ticks is multi-second in jsdom.
  it(
    "keeps idle fat-turn identity across 100 merge ticks",
    { timeout: 30_000 },
    () => {
      const idle = fatAssistantMessage("assistant-idle");
      let liveText = "";
      let identityBreaks = 0;
      const t0 = performance.now();
      for (let tick = 0; tick < 100; tick += 1) {
        liveText = `token-${tick}`;
        const live: UIMessage = {
          id: "assistant-live",
          role: "assistant",
          parts: [{ type: "text", text: liveText }],
        };
        const [mergedIdle] = mergeTrustedModelContextParts([idle, live], []);
        if (mergedIdle !== idle) identityBreaks += 1;
      }
      const ms = performance.now() - t0;

      console.log(
        JSON.stringify({
          metric: "merge-identity",
          toolCount: TOOL_COUNT,
          ticks: 100,
          identityBreaks,
          ms: Number(ms.toFixed(2)),
        }),
      );

      expect(identityBreaks).toBe(0);
    },
  );

  it(
    "reports idle commit counts for stable vs unstable message identity",
    { timeout: 30_000 },
    () => {
      const idle = fatAssistantMessage("assistant-idle");

      function measure(mode: "stable" | "unstable"): TickCost {
        let commits = 0;
        const onCommit = () => {
          commits += 1;
        };

        const mountStart = performance.now();
        const view = render(<IdleTurn message={idle} onCommit={onCommit} />);
        const mountMs = performance.now() - mountStart;
        const commitsAfterMount = commits;

        const tickStart = performance.now();
        for (let tick = 0; tick < STREAM_TICKS; tick += 1) {
          // Pre-fix merge allocated a new message AND a new parts array every
          // tick even when contents were unchanged.
          const message =
            mode === "stable" ? idle : { ...idle, parts: [...idle.parts] };
          view.rerender(<IdleTurn message={message} onCommit={onCommit} />);
        }
        const tickMs = performance.now() - tickStart;

        view.unmount();
        return {
          commitsDuringTicks: commits - commitsAfterMount,
          mountMs: Number(mountMs.toFixed(2)),
          tickMs: Number(tickMs.toFixed(2)),
        };
      }

      const unstable = measure("unstable");
      const stable = measure("stable");

      console.log(
        JSON.stringify({
          metric: "idle-commits",
          toolCount: TOOL_COUNT,
          ticks: STREAM_TICKS,
          unstable,
          stable,
          commitRatio:
            stable.commitsDuringTicks === 0
              ? "stable=0 (infinite win)"
              : Number(
                  (
                    unstable.commitsDuringTicks / stable.commitsDuringTicks
                  ).toFixed(1),
                ),
        }),
      );

      expect(stable.commitsDuringTicks).toBe(0);
      expect(unstable.commitsDuringTicks).toBe(STREAM_TICKS);
    },
  );

  it(
    "reports first-mount cost for 87 collapsed tool rows",
    { timeout: 30_000 },
    () => {
      const idle = fatAssistantMessage("assistant-idle");
      const t0 = performance.now();
      const view = render(<ToolChrome parts={idle.parts} />);
      const mountMs = performance.now() - t0;
      const tools = view.container.querySelectorAll("[data-transcript-tool]");
      const sample = tools[0];

      console.log(
        JSON.stringify({
          metric: "tool-mount",
          toolCount: TOOL_COUNT,
          mountedTools: tools.length,
          mountMs: Number(mountMs.toFixed(2)),
          // jsdom does not implement content-visibility; Chromium would.
          contentVisibility: sample
            ? getComputedStyle(sample).contentVisibility
            : null,
        }),
      );

      expect(tools.length).toBe(TOOL_COUNT);
      view.unmount();
    },
  );
});
