import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, screen, userEvent, waitFor } from "storybook/test";
import type { UIMessage } from "ai";

import type { AvailableModel } from "@/lib/services/models/queries";
import { ChatMessageRow } from "./chat-message-row";
import { ChatMarkdownProvider } from "./use-chat-markdown-ready";

/** A summary run persisted before part identity was recorded: two headings
 *  the wire glued into one `****` run. */
const GLUED_SUMMARY_RUN =
  "**Investigating likely culprit PRs****Inspecting message schema**";
const SECOND_SUMMARY_HEADING = "**Analyzing interrupted tool call impact**";
const POST_TOOL_HEADING = "**Following up on the tool result**";
const ANSWER_TEXT = "Both summaries describe the same investigation.";

function summaryRunMessage(
  lastReasoningState: "streaming" | "done",
): UIMessage {
  return {
    id: "assistant-1",
    role: "assistant",
    parts: [
      { type: "reasoning", text: GLUED_SUMMARY_RUN, state: "done" },
      { type: "reasoning", text: SECOND_SUMMARY_HEADING, state: "done" },
      {
        type: "dynamic-tool",
        toolCallId: "call-1",
        toolName: "search_conversations",
        state: "output-available",
        input: { query: "reasoning summaries" },
        output: { matches: 3 },
      },
      { type: "reasoning", text: POST_TOOL_HEADING, state: lastReasoningState },
      { type: "text", text: ANSWER_TEXT },
    ],
  };
}

const PERSISTED_MESSAGE = summaryRunMessage("done");
const STREAMING_MESSAGE = summaryRunMessage("streaming");

// Captured before any story renders: rendering must never rewrite a persisted
// part, because those bytes are what the provider signed or encrypted.
const persistedPartsAtLoad = JSON.stringify(PERSISTED_MESSAGE.parts);

const meta = {
  component: ChatMessageRow,
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <ChatMarkdownProvider>
        <Story />
      </ChatMarkdownProvider>
    ),
  ],
  args: {
    renderKey: "story-message",
    boundary: null,
    modelBoundary: null,
    isLast: false,
    chatId: "chat-1",
    status: "ready",
    availableModels: [],
    onForked: fn(),
    onInspectContext: fn(),
  },
  parameters: { layout: "padded" },
} satisfies Meta<typeof ChatMessageRow>;

export default meta;
type Story = StoryObj<typeof meta>;
type PlayContext = Parameters<NonNullable<Story["play"]>>[0];

/** The bold titles rendered inside one Thinking panel's body. Streamdown
 *  renders `**bold**` as a tagged span, not a `strong` element. */
function renderedTitlesIn(trigger: HTMLElement): Array<string | null> {
  const panel = trigger
    .closest('[data-slot="collapsible"]')
    ?.querySelector('[data-slot="collapsible-content"]');
  if (!panel) return [];
  return Array.from(
    panel.querySelectorAll('[data-streamdown="strong"]'),
    (el) => el.textContent,
  );
}

/** The panel boundaries every conversation state must show: one Thinking
 *  panel per uninterrupted summary run, the tool between them, and the answer
 *  after — persisted order intact, reasoning never hoisted above the tool. */
async function expectGroupedSummaryRun({ canvas }: PlayContext): Promise<void> {
  const triggers = await waitFor(
    () => {
      const found = canvas.getAllByRole("button", {
        name: /thinking|thought/i,
      });
      expect(found).toHaveLength(2);
      return found;
    },
    // The row withholds the transcript until the Streamdown-backed markdown
    // renderers load, so the first query waits on that chunk.
    { timeout: 15_000 },
  );
  const [preToolPanel, postToolPanel] = triggers;

  const toolTitle = canvas.getByText(/search_conversations/i);
  expect(
    preToolPanel.compareDocumentPosition(toolTitle) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  expect(
    postToolPanel.compareDocumentPosition(toolTitle) &
      Node.DOCUMENT_POSITION_PRECEDING,
  ).toBe(Node.DOCUMENT_POSITION_PRECEDING);

  // The first panel holds the whole pre-tool run: the glued `****` pair
  // repaired into two separate titles, plus the second persisted part.
  await userEvent.click(preToolPanel);
  await waitFor(() => {
    expect(renderedTitlesIn(preToolPanel)).toEqual([
      "Investigating likely culprit PRs",
      "Inspecting message schema",
      "Analyzing interrupted tool call impact",
    ]);
  });

  // The post-tool summary is its own panel, not merged into the first.
  await userEvent.click(postToolPanel);
  await waitFor(() => {
    expect(renderedTitlesIn(postToolPanel)).toEqual([
      "Following up on the tool result",
    ]);
  });

  await expect(canvas.getByText(ANSWER_TEXT)).toBeVisible();
}

/**
 * A reloaded chat whose first two reasoning-summary parts were persisted as
 * one uninterrupted run: they share one Thinking panel (the glued `****` pair
 * inside it rendering as two bold titles), the tool call keeps its place
 * between the panels, and the third summary opens a second panel.
 *
 * @summary grouped panels for persisted multi-summary reasoning
 */
export const PersistedHistory: Story = {
  tags: ["ai-generated"],
  args: { message: PERSISTED_MESSAGE },
  play: async (context) => {
    await expectGroupedSummaryRun(context);

    // The repair is display-only: the stored part still holds the provider's
    // exact bytes, glued run and all.
    expect(JSON.stringify(PERSISTED_MESSAGE.parts)).toBe(persistedPartsAtLoad);
    expect(PERSISTED_MESSAGE.parts[0]).toEqual({
      type: "reasoning",
      text: "**Investigating likely culprit PRs****Inspecting message schema**",
      state: "done",
    });
  },
};

/**
 * The same run while the model is still thinking: live output has the same
 * panel boundaries and the same tool position as the reloaded chat, so a
 * reconnect or reload cannot re-flow the transcript.
 *
 * @summary grouped panels while the run streams
 */
export const LiveStreaming: Story = {
  tags: ["ai-generated"],
  args: { message: STREAMING_MESSAGE },
  play: async (context) => {
    await expectGroupedSummaryRun(context);
  },
};

/** A thinking block whose text the provider withheld: signed, persisted with
 *  empty text, and therefore never shown — but its signature is what replay
 *  needs, so it must survive rendering byte-identical. */
const WITHHELD_SIGNATURE = "opaque-withheld-thinking-signature";
const VISIBLE_THOUGHT_HEADING = "**Visible thinking heading**";
const ANSWER_BEFORE_THOUGHT = "Answer recorded before the visible thought.";
const ANSWER_AFTER_THOUGHT = "Answer recorded after the visible thought.";

function withheldTextMessage(): UIMessage {
  return {
    id: "assistant-withheld",
    role: "assistant",
    parts: [
      {
        type: "reasoning",
        text: "",
        state: "done",
        providerMetadata: { anthropic: { signature: WITHHELD_SIGNATURE } },
      },
      // A whitespace-only delivery joins the same run: still nothing to show.
      { type: "reasoning", text: "\n  \n", state: "done" },
      { type: "text", text: ANSWER_BEFORE_THOUGHT },
      { type: "reasoning", text: VISIBLE_THOUGHT_HEADING, state: "done" },
      { type: "text", text: ANSWER_AFTER_THOUGHT },
    ],
  };
}

const WITHHELD_MESSAGE = withheldTextMessage();
const withheldPartsAtLoad = JSON.stringify(WITHHELD_MESSAGE.parts);

/**
 * A turn that carries a signed, withheld-text thinking block followed by a
 * visible summary: the empty run renders no Thinking panel at all, the visible
 * run still renders exactly one, and the transcript keeps its stored order.
 *
 * @summary a segment with no text renders no Thinking panel
 */
export const WithheldTextReasoning: Story = {
  tags: ["ai-generated"],
  args: { message: WITHHELD_MESSAGE },
  play: async ({ canvas }) => {
    // Exactly one panel: the withheld run's parts contribute none. Waits out
    // the Streamdown-backed renderers the row gates its transcript on.
    const [visiblePanel] = await waitFor(
      () => {
        const found = canvas.getAllByRole("button", {
          name: /thinking|thought/i,
        });
        expect(found).toHaveLength(1);
        return found;
      },
      { timeout: 15_000 },
    );

    // The opaque signature is replay input, never display state.
    expect(canvas.queryByText(WITHHELD_SIGNATURE)).toBeNull();

    // The skipped run leaves no gap and moves nothing: answer, panel, answer.
    const answerBeforeThought = canvas.getByText(ANSWER_BEFORE_THOUGHT);
    const answerAfterThought = canvas.getByText(ANSWER_AFTER_THOUGHT);
    expect(
      visiblePanel.compareDocumentPosition(answerBeforeThought) &
        Node.DOCUMENT_POSITION_PRECEDING,
    ).toBe(Node.DOCUMENT_POSITION_PRECEDING);
    expect(
      visiblePanel.compareDocumentPosition(answerAfterThought) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);

    // The visible run still renders its text in full.
    await userEvent.click(visiblePanel);
    await waitFor(() => {
      expect(renderedTitlesIn(visiblePanel)).toEqual([
        "Visible thinking heading",
      ]);
    });

    // Rendering never rewrites a persisted part.
    expect(JSON.stringify(WITHHELD_MESSAGE.parts)).toBe(withheldPartsAtLoad);
  },
};

/** The row the stream's `start` frame creates: an assistant turn whose id is
 *  the accepted Run's, carrying no parts until the model answers. */
const PENDING_MESSAGE: UIMessage = {
  id: "11111111-1111-1111-1111-111111111111",
  role: "assistant",
  parts: [],
};

/**
 * The accepted turn before any model output: the last row of a chat in flight
 * shimmers "Thinking…" in place of the empty bubble it would otherwise paint,
 * and offers no fork action for an id that names a Run rather than a message.
 *
 * @summary the pending indicator on the turn being produced
 */
export const PendingIndicator: Story = {
  tags: ["ai-generated"],
  args: { message: PENDING_MESSAGE, isLast: true, status: "submitted" },
  play: async ({ canvas }) => {
    // The row withholds its content until the Streamdown-backed renderers
    // load, so the first query waits on that chunk like the sibling stories.
    await waitFor(() => expect(canvas.getByText("Thinking…")).toBeVisible(), {
      timeout: 15_000,
    });
    await expect(canvas.queryByRole("button", { name: /fork/i })).toBeNull();
  },
};

/** The catalog entry an operator-declared Claude model resolves to, so the
 *  badge and the Cost & model column name the model instead of echoing its id. */
const CLAUDE_SONNET_MODEL: AvailableModel = {
  id: "system:anthropic:claude-sonnet-5",
  source: "system",
  name: "Claude Sonnet 5",
  contextWindowTokens: 1_000_000,
};

const CACHE_WRITE_ANSWER = "Summarized the cached document.";

/**
 * The telemetry of a cache-heavy Anthropic turn: the provider reports the
 * cache-creation count separately, as a subset of the input total that Input
 * already includes.
 */
const CACHE_WRITE_MESSAGE: UIMessage = {
  id: "assistant-cache-write",
  role: "assistant",
  metadata: {
    usage: {
      inputTokens: 12_800,
      cachedInputTokens: 0,
      cacheWriteTokens: 11_200,
      outputTokens: 20,
      totalTokens: 12_820,
      reasoningTokens: 0,
      modelId: CLAUDE_SONNET_MODEL.id,
      latencyMs: 900,
      costUsd: 0.01,
      status: "completed",
    },
  },
  parts: [{ type: "text", text: CACHE_WRITE_ANSWER }],
};

/**
 * A completed turn whose long prompt was written to the provider's cache:
 * hovering the usage badge reveals the reported cache-creation tokens as an
 * "of which cache write" row beneath Input, so the largest line of a
 * cache-heavy turn stays visible without inflating the Input total.
 *
 * @summary the usage hover card shows the turn's cache-write tokens
 */
export const CacheWriteUsage: Story = {
  tags: ["ai-generated"],
  args: {
    message: CACHE_WRITE_MESSAGE,
    availableModels: [CLAUDE_SONNET_MODEL],
  },
  play: async ({ canvas }) => {
    // The row withholds the transcript — footer included — until the
    // Streamdown-backed renderers load, so the first query waits on that chunk
    // like the sibling stories do.
    const trigger = await waitFor(
      () => canvas.getByRole("button", { name: /^Message usage:/ }),
      { timeout: 15_000 },
    );
    await expect(trigger).toHaveTextContent("Claude Sonnet 5 · 900ms");

    await userEvent.hover(trigger);

    // The breakdown portals out of the canvas into the document body, so the
    // card's rows are queried through `screen` rather than `canvas`.
    const cacheWriteRow = await waitFor(
      () => {
        const row = screen.getByText("of which cache write").parentElement;
        expect(row).toBeVisible();
        return row;
      },
      // Hovering opens the card immediately (delay=0); this covers the
      // positioner's first measurement, which lands a frame later.
      { timeout: 2000 },
    );

    await expect(cacheWriteRow).toHaveTextContent("11.2k");
  },
};
