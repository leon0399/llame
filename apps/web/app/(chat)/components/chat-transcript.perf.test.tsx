// @vitest-environment jsdom

/**
 * Container exception (testing rule 5): quantitative + regression harness for
 * stream-tick reconcile cost on the production memoized row (via commit
 * probe), not a local stand-in. Mocks nothing — anti-slop forbids module
 * mocks; the probe fires only when memo allows a render.
 */

import { cleanup, render } from "@testing-library/react";
import type { UIMessage } from "ai";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from "@workspace/ui/components/ai-elements/tool";

import {
  mergeTrustedModelContextParts,
  messageRenderKey,
} from "@/lib/services/chat/history";

import {
  ChatTranscriptMessageList,
  setTranscriptMessageCommitProbe,
} from "./chat-transcript";

const TOOL_COUNT = 87;
const STREAM_TICKS = 50;
const EMPTY_MODELS: ReadonlyArray<never> = [];
const onForked = () => {};
const onInspectContext = () => {};

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

afterEach(() => {
  cleanup();
  setTranscriptMessageCommitProbe(null);
});

beforeEach(() => {
  setTranscriptMessageCommitProbe(null);
});

describe("chat transcript stream-tick cost (perf)", () => {
  it(
    "does not re-render an idle fat row across merge+memo stream ticks",
    { timeout: 30_000 },
    () => {
      const idle = fatAssistantMessage("assistant-idle");
      let live: UIMessage = {
        id: "assistant-live",
        role: "assistant",
        parts: [{ type: "text", text: "" }],
      };
      const rowRenderCounts = new Map<string, number>();
      setTranscriptMessageCommitProbe((renderKey) => {
        rowRenderCounts.set(
          renderKey,
          (rowRenderCounts.get(renderKey) ?? 0) + 1,
        );
      });

      const view = render(
        <ChatTranscriptMessageList
          chatId="chat-1"
          displayMessages={mergeTrustedModelContextParts([idle, live], [])}
          compaction={null}
          compactionIndex={0}
          availableModels={EMPTY_MODELS}
          status="streaming"
          onInspectContext={onInspectContext}
          onForked={onForked}
        />,
      );

      const idleKey = messageRenderKey(idle);
      const liveKey = messageRenderKey(live);
      const idleAfterMount = rowRenderCounts.get(idleKey) ?? 0;
      const liveAfterMount = rowRenderCounts.get(liveKey) ?? 0;
      expect(idleAfterMount).toBeGreaterThan(0);
      expect(liveAfterMount).toBeGreaterThan(0);

      const tickStart = performance.now();
      for (let tick = 0; tick < STREAM_TICKS; tick += 1) {
        live = {
          id: "assistant-live",
          role: "assistant",
          parts: [{ type: "text", text: `token-${tick}` }],
        };
        const displayMessages = mergeTrustedModelContextParts([idle, live], []);
        expect(displayMessages[0]).toBe(idle);
        view.rerender(
          <ChatTranscriptMessageList
            chatId="chat-1"
            displayMessages={displayMessages}
            compaction={null}
            compactionIndex={0}
            availableModels={EMPTY_MODELS}
            status="streaming"
            onInspectContext={onInspectContext}
            onForked={onForked}
          />,
        );
      }
      const tickMs = performance.now() - tickStart;

      const idleAfterTicks = rowRenderCounts.get(idleKey) ?? 0;
      const liveAfterTicks = rowRenderCounts.get(liveKey) ?? 0;

      console.log(
        JSON.stringify({
          metric: "idle-row-commits",
          toolCount: TOOL_COUNT,
          ticks: STREAM_TICKS,
          idleRenders: idleAfterTicks,
          liveRenders: liveAfterTicks,
          idleRendersDuringTicks: idleAfterTicks - idleAfterMount,
          liveRendersDuringTicks: liveAfterTicks - liveAfterMount,
          tickMs: Number(tickMs.toFixed(2)),
        }),
      );

      // Production memo + merge identity: idle fat turn must not re-commit.
      // Removing memo from ChatTranscriptMessage fails this assertion.
      expect(idleAfterTicks - idleAfterMount).toBe(0);
      expect(liveAfterTicks - liveAfterMount).toBe(STREAM_TICKS);

      view.unmount();
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

      console.log(
        JSON.stringify({
          metric: "tool-mount",
          toolCount: TOOL_COUNT,
          mountedTools: tools.length,
          mountMs: Number(mountMs.toFixed(2)),
          contentVisibility: tools[0]
            ? getComputedStyle(tools[0]).contentVisibility
            : null,
        }),
      );

      // Attribute the mount path landed on the production Tool chrome, not
      // the fixture loop length (that would be tautological).
      expect(tools.length).toBeGreaterThan(0);
      expect(tools[0]?.hasAttribute("data-transcript-tool")).toBe(true);
      view.unmount();
    },
  );
});
