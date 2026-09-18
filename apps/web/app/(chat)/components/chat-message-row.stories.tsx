import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, userEvent, waitFor } from "storybook/test";
import type { UIMessage } from "ai";

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
