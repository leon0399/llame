import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, screen, userEvent, waitFor, within } from "storybook/test";
import { vi } from "vitest";
import type { UIMessage } from "ai";

import { ChatProvider } from "@/contexts/chat-context";
import type { ChatLatestRunResponse } from "@/lib/api/generated/models";
import * as modelQueries from "@/lib/services/models/queries";
import type { AvailableModel } from "@/lib/services/models/queries";
import * as permissionModeQueries from "@/lib/services/permission-modes/queries";

// Import via the REAL specifiers: sb.mock (preview.tsx) redirects them to the
// __mocks__ modules, so these are the SAME hooks the selector reads.
const useModelsQueryMock = vi.mocked(modelQueries.useModelsQuery, {
  partial: true,
});
const usePermissionModesQueryMock = vi.mocked(
  permissionModeQueries.usePermissionModesQuery,
  { partial: true },
);
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

const WEB_SEARCH_OUTPUT = {
  status: "success",
  kind: "results",
  engine: "brave",
  query: "quiet mechanical keyboards",
  results: [
    {
      title: "Quiet mechanical keyboards",
      url: "https://example.com/keyboards",
      published: "2026-10-01",
      snippet: "A guide to quieter switches and stabilizers.",
    },
    {
      title: "Switch sound comparison",
      url: "https://example.net/switches",
      published: "2026-09-28",
      snippet: "Measured sound profiles for common keyboard switches.",
    },
    {
      title: "Desk setup acoustics",
      url: "https://example.org/acoustics",
      published: "2026-09-20",
      snippet: "Practical ways to reduce noise in a home office.",
    },
  ],
} as const;

/** The live and the stored form of one web search part carrying `output`. */
function webSearchMessages(output: { readonly query: string }, suffix: string) {
  const input = { query: output.query };
  return {
    live: {
      id: `assistant-web-search-${suffix}-live`,
      role: "assistant",
      parts: [
        {
          type: "dynamic-tool",
          toolCallId: `web-search-${suffix}-live`,
          toolName: "web_search",
          state: "output-available",
          input,
          output,
        },
      ],
    } satisfies UIMessage,
    historical: {
      id: `assistant-web-search-${suffix}-history`,
      role: "assistant",
      parts: [
        {
          type: "tool-web_search",
          toolCallId: `web-search-${suffix}-history`,
          state: "output-available",
          input,
          output,
        },
      ],
    } satisfies UIMessage,
  };
}

const WEB_SEARCH_MESSAGES = webSearchMessages(WEB_SEARCH_OUTPUT, "results");

const WEB_SEARCH_ANSWERS_OUTPUT = {
  ...WEB_SEARCH_OUTPUT,
  engine: "aggregate",
  answers: [
    {
      engine: "claude-search",
      answer: "**Aggregate answers** follow the results.",
      citations: [
        { title: "Keyboard acoustics", url: "https://example.com/acoustics" },
      ],
    },
  ],
};

const WEB_SEARCH_ANSWERS_MESSAGES = webSearchMessages(
  WEB_SEARCH_ANSWERS_OUTPUT,
  "answers",
);

const CANCELLED_WEB_SEARCH_ERROR = "The web search was cancelled.";
const CANCELLED_WEB_SEARCH_MESSAGE: UIMessage = {
  id: "assistant-web-search-cancelled",
  role: "assistant",
  parts: [
    {
      type: "tool-web_search",
      toolCallId: "web-search-cancelled",
      state: "output-error",
      input: { query: "cancelled search" },
      errorText: CANCELLED_WEB_SEARCH_ERROR,
      resultProviderMetadata: { llame: { cancelled: true } },
    },
  ],
};

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
    latestRun: null,
    onFollowUp: fn(),
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

// The web_search Parameters panel renders through the shared Shiki CodeBlock,
// whose built-in "one-light" palette ships token colors below WCAG AA
// color-contrast (same third-party-theme defect code-block.stories.tsx
// suppresses). Only the color-contrast rule is disabled.
const webSearchShikiContrastKnownIssue = {
  a11y: {
    config: {
      rules: [{ id: "color-contrast", enabled: false }],
    },
  },
};

/** Expands the two web_search rows these stories render side by side. */
async function expandWebSearchRows(
  canvas: Pick<ReturnType<typeof within>, "getAllByRole">,
): Promise<void> {
  const headers = await waitFor(
    () => {
      const found = canvas.getAllByRole("button", { name: /web_search/iu });
      expect(found).toHaveLength(2);
      return found;
    },
    { timeout: 15_000 },
  );
  for (const header of headers) {
    if (header.getAttribute("aria-expanded") === "false") {
      await userEvent.click(header);
    }
  }
}

/**
 * Live dynamic-tool parts and stored tool-web_search parts use the same
 * dedicated renderer, so reloading a completed search preserves its links.
 *
 * @summary live and historical web-search parts render the same links
 */
export const LiveAndHistoricalWebSearch: Story = {
  tags: ["ai-generated"],
  parameters: webSearchShikiContrastKnownIssue,
  args: { message: WEB_SEARCH_MESSAGES.live },
  render: (args) => (
    <div>
      <ChatMessageRow {...args} renderKey="web-search-live" />
      <ChatMessageRow
        {...args}
        renderKey="web-search-history"
        message={WEB_SEARCH_MESSAGES.historical}
      />
    </div>
  ),
  play: async ({ canvas }) => {
    await expandWebSearchRows(canvas);

    for (const result of WEB_SEARCH_OUTPUT.results) {
      const found = await waitFor(() => {
        const buttons = canvas.getAllByRole("button", { name: result.title });
        expect(buttons).toHaveLength(2);
        return buttons;
      });
      for (const button of found) {
        expect(button).toHaveAttribute("data-streamdown", "link");
      }
    }
    expect(canvas.queryAllByRole("link")).toHaveLength(0);
  },
};

/**
 * A live search and a reloaded one both render an aggregate's attached answer
 * after the results, with its engine id, Markdown text, and citation link.
 *
 * @summary live and historical parts render attached answers
 */
export const LiveAndHistoricalWebSearchAnswers: Story = {
  tags: ["ai-generated"],
  parameters: webSearchShikiContrastKnownIssue,
  args: { message: WEB_SEARCH_ANSWERS_MESSAGES.live },
  render: (args) => (
    <div>
      <ChatMessageRow {...args} renderKey="web-search-answers-live" />
      <ChatMessageRow
        {...args}
        renderKey="web-search-answers-history"
        message={WEB_SEARCH_ANSWERS_MESSAGES.historical}
      />
    </div>
  ),
  play: async ({ canvas }) => {
    await expandWebSearchRows(canvas);
    await waitFor(
      () => {
        expect(canvas.getAllByText("Aggregate answers")).toHaveLength(2);
        expect(canvas.getAllByText(/claude-search/u)).toHaveLength(2);
        expect(
          canvas.getAllByRole("button", { name: "Keyboard acoustics" }),
        ).toHaveLength(2);
      },
      { timeout: 15_000 },
    );
  },
};

/**
 * A cancelled search keeps the neutral cancelled status and does not expose
 * the transport's cancellation text as a tool error.
 *
 * @summary cancelled web search omits error text
 */
export const CancelledWebSearch: Story = {
  tags: ["ai-generated"],
  parameters: webSearchShikiContrastKnownIssue,
  args: { message: CANCELLED_WEB_SEARCH_MESSAGE },
  play: async ({ canvas }) => {
    const header = await waitFor(
      () => canvas.getByRole("button", { name: /web_search/iu }),
      { timeout: 15_000 },
    );
    await userEvent.click(header);
    await expect(canvas.getByText("Cancelled")).toBeVisible();
    expect(
      canvas.queryByText(CANCELLED_WEB_SEARCH_ERROR),
    ).not.toBeInTheDocument();
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
 * shimmers "Thinking…" in place of the empty bubble it would otherwise paint.
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
  },
};

/**
 * A live-only empty placeholder after Stop settles: the bubble is withheld,
 * but a compaction marker attached to that index stays visible.
 *
 * @summary hidden placeholder keeps its compaction boundary
 */
export const HiddenPlaceholderKeepsBoundary: Story = {
  tags: ["ai-generated"],
  args: {
    message: PENDING_MESSAGE,
    isLast: false,
    status: "ready",
    boundary: <div>Compaction checkpoint</div>,
  },
  play: async ({ canvas }) => {
    await waitFor(
      () => expect(canvas.getByText("Compaction checkpoint")).toBeVisible(),
      { timeout: 15_000 },
    );
    await expect(canvas.queryByText("Thinking…")).toBeNull();
  },
};

/** A stored owner attachment: a `file` part referencing the media store. */
const IMAGE_PART: UIMessage["parts"][number] = {
  type: "file",
  mediaType: "image/png",
  url: "media://0192f4a8-7c1e-7d3a-9b2f-3c4d5e6f7a8b",
  filename: "diagram.png",
};
const IMAGE_CAPTION = "What does this diagram show?";

const SECOND_IMAGE_PART: UIMessage["parts"][number] = {
  type: "file",
  mediaType: "image/jpeg",
  url: "media://0192f4a8-7c1e-7d3a-9b2f-3c4d5e6f7a8c",
  filename: "photo.jpg",
};

/**
 * An owner message with two attached images and a prompt: thumbnails sit
 * above the bubble in stored order, each lazily loading the image's `/model`
 * route, and the `file` parts never reach the "unsupported part type"
 * fallback.
 *
 * @summary attached images render as thumbnails above their text
 */
export const AttachedImageWithText: Story = {
  tags: ["ai-generated"],
  args: {
    message: {
      id: "user-image-text",
      role: "user",
      parts: [
        IMAGE_PART,
        SECOND_IMAGE_PART,
        { type: "text", text: IMAGE_CAPTION },
      ],
    },
  },
  play: async ({ canvas }) => {
    const caption = await waitFor(() => canvas.getByText(IMAGE_CAPTION), {
      timeout: 15_000,
    });
    await expect(canvas.queryByText(/unsupported part type/)).toBeNull();
    const list = canvas.getByRole("list", { name: "Attachments" });
    const images = within(list).getAllByRole("img");
    await expect(images.map((image) => image.getAttribute("alt"))).toEqual([
      "diagram.png",
      "photo.jpg",
    ]);
    await expect(images[0]).toHaveAttribute(
      "src",
      expect.stringMatching(
        /^https?:\/\/[^/]+\/api\/v1\/media\/0192f4a8-7c1e-7d3a-9b2f-3c4d5e6f7a8b\/model$/,
      ),
    );
    await expect(images[1]).toHaveAttribute(
      "src",
      expect.stringMatching(
        /\/api\/v1\/media\/0192f4a8-7c1e-7d3a-9b2f-3c4d5e6f7a8c\/model$/,
      ),
    );
    await expect(images[0]).toHaveAttribute("loading", "lazy");
    // Nothing to remove or retry.
    await expect(
      within(list).queryByRole("button", { name: /^(Remove|Retry)/ }),
    ).toBeNull();
    // The thumbnails come before the bubble.
    await expect(
      list.compareDocumentPosition(caption) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  },
};

/**
 * Activating an attached thumbnail opens a lightbox over this message's
 * attachments only, on the stored original captioned with its `media://`
 * locator; the arrow keys move between them and `Escape` returns focus to
 * the thumbnail.
 *
 * @summary an attached image opens the message's lightbox
 */
export const AttachedImageOpensLightbox: Story = {
  tags: ["ai-generated"],
  args: AttachedImageWithText.args,
  play: async ({ canvas }) => {
    const list = await waitFor(
      () => canvas.getByRole("list", { name: "Attachments" }),
      { timeout: 15_000 },
    );
    const opener = within(list).getByRole("button", { name: "photo.jpg" });
    await userEvent.click(opener);
    const dialog = await screen.findByRole("dialog", { name: "photo.jpg" });
    await waitFor(() => expect(dialog).toBeVisible());
    await expect(dialog).toHaveAccessibleDescription(
      "media://0192f4a8-7c1e-7d3a-9b2f-3c4d5e6f7a8c",
    );
    await expect(
      within(dialog).getByRole("img", { name: "photo.jpg" }),
    ).toHaveAttribute(
      "src",
      expect.stringMatching(
        /\/api\/v1\/media\/0192f4a8-7c1e-7d3a-9b2f-3c4d5e6f7a8c\/original$/,
      ),
    );

    await userEvent.keyboard("{ArrowLeft}");
    await waitFor(() =>
      expect(dialog).toHaveAccessibleDescription(
        "media://0192f4a8-7c1e-7d3a-9b2f-3c4d5e6f7a8b",
      ),
    );
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(opener).toHaveFocus());
  },
};

/**
 * An image-only owner message: its thumbnail and fork action, no fallback
 * text and no empty bubble between them.
 *
 * @summary an image-only message paints thumbnails and no bubble
 */
export const ImageOnlyMessage: Story = {
  tags: ["ai-generated"],
  args: {
    renderKey: "user-image-only",
    message: { id: "user-image-only", role: "user", parts: [IMAGE_PART] },
  },
  play: async ({ canvas, canvasElement }) => {
    const fork = await waitFor(
      () => canvas.getByRole("button", { name: "Fork from here" }),
      { timeout: 15_000 },
    );
    await expect(canvas.queryByText(/unsupported part type/)).toBeNull();
    const list = canvas.getByRole("list", { name: "Attachments" });
    // The thumbnails are the row's first child and the action row its second:
    // no bubble sits between them.
    const row = canvasElement.querySelector(
      '[data-message-key="user-image-only"]',
    );
    await expect(row?.children[0]).toBe(list);
    await expect(row?.children[1]).toContainElement(fork);
  },
};

/**
 * The reply's action row keeps its layout space but stays transparent until
 * the message is hovered or holds focus. Actions that have not shipped are
 * disabled and out of the tab order, like the sidebar's placeholders, and
 * say they are coming soon on hover; the turn-level actions are absent here
 * because this reply is not the latest turn's.
 *
 * @summary the action row reveals on focus; unshipped actions say coming soon
 */
export const ActionRowReveal: Story = {
  tags: ["ai-generated"],
  args: {
    renderKey: "assistant-actions",
    message: {
      id: "assistant-actions",
      role: "assistant",
      parts: [{ type: "text", text: ANSWER_TEXT }],
    },
  },
  play: async ({ canvas }) => {
    const fork = await waitFor(
      () => canvas.getByRole("button", { name: "Fork from here" }),
      { timeout: 15_000 },
    );
    const row = fork.parentElement;
    if (!row) throw new Error("fork has no action row");
    await expect(getComputedStyle(row).opacity).toBe("0");
    await expect(row.getBoundingClientRect().height).toBeGreaterThan(0);

    // Synthetic pointer events never set CSS :hover, so the reveal is driven
    // through the focus path that shares its rule.
    await userEvent.tab();
    await expect(canvas.getByRole("button", { name: "Copy" })).toHaveFocus();
    await waitFor(() => expect(getComputedStyle(row).opacity).toBe("1"));

    // The disabled Edit is skipped and no turn-level action is offered for
    // an older reply, so Tab lands on Fork next.
    await userEvent.tab();
    await expect(fork).toHaveFocus();
    await expect(
      canvas.queryByRole("button", { name: "Regenerate" }),
    ).toBeNull();
    await expect(canvas.queryByRole("button", { name: "Continue" })).toBeNull();
  },
};

// Reading the real clipboard back needs a permission grant the headless runner
// does not give, so the copy story swaps in a writeText spy for its duration.
const writeText = fn<(text: string) => Promise<void>>();

/**
 * Copy writes the reply's Markdown — its text parts joined by a blank line —
 * and leaves out its reasoning and tool calls.
 *
 * @summary Copy copies only the reply's text parts
 */
export const CopyReplyMarkdown: Story = {
  tags: ["ai-generated"],
  args: {
    renderKey: "assistant-copy",
    message: {
      ...PERSISTED_MESSAGE,
      parts: [
        { type: "text", text: "**Before** the tool.\n" },
        ...PERSISTED_MESSAGE.parts,
      ],
    },
  },
  beforeEach: () => {
    writeText.mockReset().mockResolvedValue(undefined);
    const original = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    return () => {
      if (original) {
        Object.defineProperty(navigator, "clipboard", original);
      } else {
        Reflect.deleteProperty(navigator, "clipboard");
      }
    };
  },
  play: async ({ canvas }) => {
    const copy = await waitFor(
      () => canvas.getByRole("button", { name: "Copy" }),
      { timeout: 15_000 },
    );
    const width = copy.getBoundingClientRect().width;
    await userEvent.click(copy);
    await expect(writeText).toHaveBeenCalledTimes(1);
    await expect(writeText).toHaveBeenCalledWith(
      `**Before** the tool.\n\n${ANSWER_TEXT}`,
    );
    // The confirmation swaps only the icon, so the row does not reflow.
    await waitFor(() =>
      expect(copy.querySelector(".lucide-check")).not.toBeNull(),
    );
    await expect(copy).toHaveAccessibleName("Copy");
    await expect(copy.getBoundingClientRect().width).toBe(width);
  },
};

/** A stored owner PDF: its tile links the `/original`, and no `/model`
 *  variant exists for it. */
const PDF_ID = "0192f4a8-7c1e-7d3a-9b2f-3c4d5e6f7a8d";
const PDF_FILENAME = "report.pdf";
const PDF_PART: UIMessage["parts"][number] = {
  type: "file",
  mediaType: "application/pdf",
  url: `media://${PDF_ID}`,
  filename: PDF_FILENAME,
};
const PDF_ORIGINAL_SRC = new RegExp(`/api/v1/media/${PDF_ID}/original$`);

/**
 * An owner message with an image and a PDF: both render above the bubble in
 * stored order. The image keeps its `/model` thumbnail and opens the
 * lightbox over this message's images; the PDF is a document tile named by
 * its stored file name whose link opens the `/original` in a new tab, so it
 * loads no image route and enters no slide.
 *
 * @summary an attached PDF renders beside an image without an image route
 */
export const AttachedImageAndPdf: Story = {
  tags: ["ai-generated"],
  args: {
    message: {
      id: "user-image-pdf",
      role: "user",
      parts: [
        IMAGE_PART,
        PDF_PART,
        { type: "text", text: "Summarize the report." },
      ],
    },
  },
  play: async ({ canvas, canvasElement, userEvent }) => {
    const caption = await waitFor(
      () => canvas.getByText("Summarize the report."),
      { timeout: 15_000 },
    );
    await expect(canvas.queryByText(/unsupported part type/)).toBeNull();
    const list = canvas.getByRole("list", { name: "Attachments" });
    const [image, pdf] = within(list).getAllByRole("listitem");
    await expect(
      within(image!).getByRole("img", { name: "diagram.png" }),
    ).toHaveAttribute(
      "src",
      expect.stringMatching(/\/api\/v1\/media\/[^/]+\/model$/),
    );
    // Stored order: the image's tile precedes the PDF's, and the bubble
    // follows both.
    await expect(
      pdf!.compareDocumentPosition(image!) & Node.DOCUMENT_POSITION_PRECEDING,
    ).toBeTruthy();
    await expect(
      list.compareDocumentPosition(caption) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    const link = within(pdf!).getByRole("link", {
      name: `Open ${PDF_FILENAME} in a new tab`,
    });
    await expect(link).toHaveAttribute(
      "href",
      expect.stringMatching(PDF_ORIGINAL_SRC),
    );
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", "noopener noreferrer");
    // The PDF loads no image route: the row's only image is the image's.
    await expect(within(list).getAllByRole("img")).toHaveLength(1);
    await expect(canvasElement.querySelector(`[src*="${PDF_ID}"]`)).toBeNull();

    // The lightbox holds this message's images only, so the PDF is no slide.
    await userEvent.click(
      within(image!).getByRole("button", { name: "diagram.png" }),
    );
    const dialog = await screen.findByRole("dialog", { name: "diagram.png" });
    await expect(within(dialog).queryByText(PDF_FILENAME)).toBeNull();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  },
};

/**
 * A PDF-only owner message: the document tile and its link render and open
 * no lightbox, while a `file` part whose URL is no `media://` locator paints
 * nothing rather than the "unsupported part type" fallback.
 *
 * @summary an attached PDF alone renders a tile and no lightbox
 */
export const AttachedPdfOnly: Story = {
  tags: ["ai-generated"],
  args: {
    renderKey: "user-pdf-only",
    message: {
      id: "user-pdf-only",
      role: "user",
      parts: [
        PDF_PART,
        {
          type: "file",
          mediaType: "application/pdf",
          url: "https://example.test/notes.pdf",
          filename: "notes.pdf",
        },
      ],
    },
  },
  play: async ({ canvas }) => {
    const fork = await waitFor(
      () => canvas.getByRole("button", { name: "Fork from here" }),
      { timeout: 15_000 },
    );
    await expect(canvas.queryByText(/unsupported part type/)).toBeNull();
    const list = canvas.getByRole("list", { name: "Attachments" });
    await expect(within(list).getAllByRole("listitem")).toHaveLength(1);
    await expect(
      within(list).getByRole("link", {
        name: `Open ${PDF_FILENAME} in a new tab`,
      }),
    ).toBeVisible();
    await expect(canvas.queryByText("notes.pdf")).toBeNull();
    await expect(within(list).queryAllByRole("img")).toEqual([]);
    await expect(canvas.queryByRole("dialog")).toBeNull();
    await expect(
      list.compareDocumentPosition(fork) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  },
};

/** The paths one in-Run bundle touched: two loaded files (one cut at the
 *  per-file cap) and the one the `read` permission group denied. */
const LOADED_INSTRUCTION_PATH = "/home/operator/repo/AGENTS.md";
const TRUNCATED_INSTRUCTION_PATH = "/home/operator/repo/apps/api/AGENTS.md";
const DENIED_INSTRUCTION_PATH = "/srv/AGENTS.md";

/** A completed turn whose Run loaded project instruction files while reading
 *  a file. The item sits after that step's tool part — the position the api
 *  stored it in and the transcript merge restores, so the chip renders where
 *  the model received it. */
const INSTRUCTIONS_MESSAGE: UIMessage = {
  id: "assistant-instructions",
  role: "assistant",
  parts: [
    { type: "text", text: "Answered with the project rules in hand." },
    {
      type: "dynamic-tool",
      toolCallId: "call-read-instructions",
      toolName: "read",
      state: "output-available",
      input: { path: "apps/api/src/x.ts" },
      output: { status: "success" },
    },
    {
      type: "data-context",
      data: {
        v: 1,
        producer: "instructions",
        form: "notice",
        runId: "11111111-1111-4111-8111-111111111111",
        payload: {
          files: [
            {
              path: LOADED_INSTRUCTION_PATH,
              canonicalPath: LOADED_INSTRUCTION_PATH,
              truncated: false,
            },
            {
              path: TRUNCATED_INSTRUCTION_PATH,
              canonicalPath: TRUNCATED_INSTRUCTION_PATH,
              truncated: true,
            },
          ],
          denied: [DENIED_INSTRUCTION_PATH],
        },
        text: '<system-reminder producer="instructions" form="notice">project instructions</system-reminder>',
      },
    },
  ],
};

/**
 * The owner chip on the assistant turn that carries an instructions item: the
 * loaded paths, the truncated marker, and the muted denied path — while the
 * item's model-visible text stays prompt input, never transcript content
 * (design D9).
 *
 * @summary the instructions chip renders on the carrying turn
 */
export const InstructionsDisclosure: Story = {
  tags: ["ai-generated"],
  args: { message: INSTRUCTIONS_MESSAGE },
  play: async ({ canvas }) => {
    // The row withholds the transcript until the Streamdown-backed renderers
    // load, so the first query waits on that chunk like the sibling stories.
    await waitFor(
      () => expect(canvas.getByText(LOADED_INSTRUCTION_PATH)).toBeVisible(),
      { timeout: 15_000 },
    );

    // The item's model-visible text is prompt input, not chat content.
    await expect(canvas.queryByText(/system-reminder/)).toBeNull();
  },
};

/** The catalog entry an operator-declared Claude model resolves to, so the
 *  badge and the Cost & model column name the model instead of echoing its id. */
const CLAUDE_SONNET_MODEL: AvailableModel = {
  id: "system:anthropic:claude-sonnet-5",
  source: "system",
  name: "Claude Sonnet 5",
  contextWindowTokens: 1_000_000,
  input: ["text"],
};

/** The catalog entry the usage fixtures resolve to, so the badge and the
 *  Cost & model column name the model instead of echoing its id. */
const GPT_4O_MODEL: AvailableModel = {
  id: "system:openai:gpt-4o",
  source: "system",
  name: "GPT-4o",
  contextWindowTokens: 128_000,
  input: ["text"],
};

/** One labeled row of a usage hover card. The breakdown portals out of the
 *  canvas into the document body a frame after hover, so its rows are queried
 *  through `screen` and waited for. Hovering opens the card immediately
 *  (delay=0); the wait covers the positioner's first measurement. */
function revealedUsageRow(label: string): Promise<HTMLElement> {
  return waitFor(
    () => {
      const row = screen.getByText(label).parentElement;
      if (!row) throw new Error(`No hover-card row labeled "${label}"`);
      expect(row).toBeVisible();
      return row;
    },
    { timeout: 2000 },
  );
}

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

    const cacheWriteRow = await revealedUsageRow("of which cache write");
    await expect(cacheWriteRow).toHaveTextContent("11.2k");
  },
};

const STREAM_METRICS_MESSAGE: UIMessage = {
  id: "assistant-stream-metrics",
  role: "assistant",
  metadata: {
    usage: {
      inputTokens: 12_800,
      cachedInputTokens: 12_000,
      cacheWriteTokens: 0,
      outputTokens: 412,
      totalTokens: 13_212,
      modelId: CLAUDE_SONNET_MODEL.id,
      latencyMs: 8240,
      firstTokenMs: 1180,
      chunkCount: 412,
      tokensPerSecond: 58.4,
      costUsd: 0.02,
      status: "completed",
      complete: true,
      billing: "usage",
    },
  },
  parts: [{ type: "text", text: "Streamed the whole answer token by token." }],
};

/**
 * A completed streamed turn: hovering the usage badge reveals the Performance
 * column's first-token time, output throughput, and chunk count beside Total,
 * so a slow start and a slow generation are told apart before reading the
 * answer.
 *
 * @summary the usage hover card shows the turn's stream performance
 */
export const StreamMetricsUsage: Story = {
  tags: ["ai-generated"],
  args: {
    message: STREAM_METRICS_MESSAGE,
    availableModels: [CLAUDE_SONNET_MODEL],
  },
  play: async ({ canvas }) => {
    const trigger = await waitFor(
      () => canvas.getByRole("button", { name: /^Message usage:/ }),
      { timeout: 15_000 },
    );
    await expect(trigger).toHaveTextContent("Claude Sonnet 5 · 8.24s");

    await userEvent.hover(trigger);

    const firstTokenRow = await revealedUsageRow("First token");
    await expect(firstTokenRow).toHaveTextContent("1.18s");
    const speedRow = await revealedUsageRow("Speed");
    await expect(speedRow).toHaveTextContent("58.4 tok/s");
    const chunksRow = await revealedUsageRow("Chunks");
    await expect(chunksRow).toHaveTextContent("412");
  },
};

const BYPASS_USAGE_MESSAGE: UIMessage = {
  id: "assistant-bypass-usage",
  role: "assistant",
  metadata: {
    usage: {
      modelId: GPT_4O_MODEL.id,
      effort: "high",
      permissionMode: "bypass",
      latencyMs: 900,
      status: "completed",
    },
  },
  parts: [{ type: "text", text: "A turn that bypassed tool permissions." }],
};

/**
 * A completed turn whose effective permission mode was bypass: the compact
 * badge marks it and the expanded Cost & model section repeats the mode.
 *
 * @summary bypassed usage is marked in the badge and detail
 */
export const BypassUsage: Story = {
  tags: ["ai-generated"],
  args: {
    message: BYPASS_USAGE_MESSAGE,
    availableModels: [GPT_4O_MODEL],
  },
  play: async ({ canvas }) => {
    const trigger = await waitFor(
      () =>
        canvas.getByRole("button", {
          name: "Message usage: GPT-4o · high · Bypass · 900ms",
        }),
      { timeout: 15_000 },
    );
    await userEvent.hover(trigger);

    const permissionModeRow = await revealedUsageRow("permission mode");
    await expect(permissionModeRow).toHaveTextContent("Bypass");
  },
};

const INCOMPLETE_USAGE_MESSAGE: UIMessage = {
  id: "assistant-incomplete-usage",
  role: "assistant",
  metadata: {
    usage: {
      inputTokens: 2400,
      cachedInputTokens: 1000,
      outputTokens: 300,
      reasoningTokens: 210,
      totalTokens: 2700,
      costUsd: 0.0063,
      complete: false,
      billing: "usage",
      modelId: GPT_4O_MODEL.id,
      latencyMs: 900,
      status: "completed",
    },
  },
  parts: [{ type: "text", text: "Recorded usage is a lower bound." }],
};

/**
 * Incomplete usage keeps its known totals and cost as lower bounds, both in
 * the badge and breakdown, and explains the uncertainty without guessing why.
 *
 * @summary incomplete usage is shown as a lower bound
 */
export const IncompleteUsage: Story = {
  tags: ["ai-generated"],
  args: {
    message: INCOMPLETE_USAGE_MESSAGE,
    availableModels: [GPT_4O_MODEL],
  },
  play: async ({ canvas }) => {
    const trigger = await waitFor(
      () => canvas.getByRole("button", { name: /^Message usage:/ }),
      { timeout: 15_000 },
    );
    // The recorded total and cost repeat their lower-bound marker in the
    // badge, where complete usage shows only the model, effort and latency.
    await expect(trigger).toHaveTextContent(
      /^GPT-4o · 900ms · ≥ 2\.7k tokens · ≥ \$0\.0063$/,
    );

    await userEvent.hover(trigger);

    const totalTokensRow = await revealedUsageRow("Total tokens");
    await expect(totalTokensRow).toHaveTextContent("≥ 2.7k");

    // A billed cost keeps the ordinary value styling.
    const costRow = await revealedUsageRow("Est. cost");
    const costValue = costRow.querySelector("b");
    expect(costValue).not.toBeNull();
    await expect(costValue).toHaveTextContent("≥ $0.0063");
    expect(costValue).not.toHaveClass("text-muted-foreground");
    expect(costValue).not.toHaveClass("line-through");

    // Reasoning is a subset of Output, and a real value here.
    const outputRow = await revealedUsageRow("Output");
    const reasoningRow = await revealedUsageRow("of which reasoning");
    expect(reasoningRow.previousElementSibling).toBe(outputRow);
    await expect(reasoningRow).toHaveTextContent("210");

    await expect(
      screen.getByText("Recorded usage may not cover all of this Run's spend"),
    ).toBeVisible();
  },
};

const SUBSCRIPTION_USAGE_MESSAGE: UIMessage = {
  id: "assistant-subscription-usage",
  role: "assistant",
  metadata: {
    usage: {
      inputTokens: 2400,
      cachedInputTokens: 1000,
      outputTokens: 300,
      reasoningTokens: 210,
      totalTokens: 2700,
      costUsd: 0.0063,
      complete: true,
      billing: "subscription",
      modelId: GPT_4O_MODEL.id,
      latencyMs: 900,
      status: "completed",
    },
  },
  parts: [{ type: "text", text: "A subscription-billed answer." }],
};

/**
 * A configured price on a subscription is displayed as notional, not billed.
 *
 * @summary subscription usage marks cost as not billed
 */
export const SubscriptionCost: Story = {
  tags: ["ai-generated"],
  args: {
    message: SUBSCRIPTION_USAGE_MESSAGE,
    availableModels: [GPT_4O_MODEL],
  },
  play: async ({ canvas }) => {
    const trigger = await waitFor(
      () => canvas.getByRole("button", { name: /^Message usage:/ }),
      { timeout: 15_000 },
    );
    await expect(trigger).toHaveTextContent("GPT-4o · 900ms");

    await userEvent.hover(trigger);

    const costValue = (await revealedUsageRow("Notional cost")).querySelector(
      "b",
    );
    await expect(costValue).toHaveTextContent("$0.0063, not billed");
    expect(costValue).toHaveClass("text-muted-foreground");
    expect(costValue).toHaveClass("line-through");
    await expect(screen.getByText(", not billed")).toBeVisible();
  },
};

const MODEL_ONLY_USAGE_MESSAGE: UIMessage = {
  id: "assistant-model-only-usage",
  role: "assistant",
  metadata: { usage: { modelId: GPT_4O_MODEL.id } },
  parts: [{ type: "text", text: "A turn that reported no usage at all." }],
};

/**
 * A record that names its model but carries no counts: every token value reads
 * unavailable rather than zero.
 *
 * @summary unknown token counts render as unavailable
 */
export const ModelOnlyUsage: Story = {
  tags: ["ai-generated"],
  args: {
    message: MODEL_ONLY_USAGE_MESSAGE,
    availableModels: [GPT_4O_MODEL],
  },
  play: async ({ canvas }) => {
    const trigger = await waitFor(
      () => canvas.getByRole("button", { name: "Message usage: GPT-4o" }),
      { timeout: 15_000 },
    );
    await userEvent.hover(trigger);

    for (const label of ["Input", "Output", "of which reasoning"]) {
      const row = await revealedUsageRow(label);
      await expect(row).toHaveTextContent(`${label}—`);
    }
  },
};

const TINY_INCOMPLETE_COST_MESSAGE: UIMessage = {
  id: "assistant-tiny-incomplete-cost",
  role: "assistant",
  metadata: {
    usage: {
      inputTokens: 10,
      outputTokens: 20,
      totalTokens: 30,
      costUsd: 0.0000429,
      complete: false,
      billing: "usage",
      modelId: GPT_4O_MODEL.id,
    },
  },
  parts: [{ type: "text", text: "A cheap, incomplete turn." }],
};

/**
 * A sub-cent incomplete cost keeps a numeric floor instead of the "less than
 * $0.0001" wording a complete cost at that size uses.
 *
 * @summary a tiny incomplete cost keeps a numeric floor
 */
export const TinyIncompleteCost: Story = {
  tags: ["ai-generated"],
  args: {
    message: TINY_INCOMPLETE_COST_MESSAGE,
    availableModels: [GPT_4O_MODEL],
  },
  play: async ({ canvas }) => {
    const trigger = await waitFor(
      () => canvas.getByRole("button", { name: /^Message usage:/ }),
      { timeout: 15_000 },
    );
    await expect(trigger).toHaveTextContent(
      /^GPT-4o · ≥ 30 tokens · ≥ \$0\.000042$/,
    );

    await userEvent.hover(trigger);

    const costValue = (await revealedUsageRow("Est. cost")).querySelector("b");
    await expect(costValue).toHaveTextContent("≥ $0.000042");
  },
};

const INCOMPLETE_SUBSCRIPTION_USAGE_MESSAGE: UIMessage = {
  id: "assistant-incomplete-subscription-usage",
  role: "assistant",
  metadata: {
    usage: {
      inputTokens: 2400,
      outputTokens: 300,
      totalTokens: 2700,
      costUsd: 0.0063,
      complete: false,
      billing: "subscription",
      modelId: GPT_4O_MODEL.id,
    },
  },
  parts: [{ type: "text", text: "A subscription turn with incomplete usage." }],
};

/**
 * Incomplete subscription usage keeps the lower-bound token total in its badge
 * but never a cost that was not billed, while the card still shows the
 * notional floor with the same lower-bound marker.
 *
 * @summary a notional cost stays out of the incomplete badge
 */
export const IncompleteSubscriptionCost: Story = {
  tags: ["ai-generated"],
  args: {
    message: INCOMPLETE_SUBSCRIPTION_USAGE_MESSAGE,
    availableModels: [GPT_4O_MODEL],
  },
  play: async ({ canvas }) => {
    const trigger = await waitFor(
      () => canvas.getByRole("button", { name: /^Message usage:/ }),
      { timeout: 15_000 },
    );
    await expect(trigger).toHaveTextContent(/^GPT-4o · ≥ 2\.7k tokens$/);

    await userEvent.hover(trigger);

    const costValue = (await revealedUsageRow("Notional cost")).querySelector(
      "b",
    );
    await expect(costValue).toHaveTextContent("≥ $0.0063, not billed");
    expect(costValue).toHaveClass("text-muted-foreground");
    expect(costValue).toHaveClass("line-through");
  },
};

const COMPLETE_USAGE_MESSAGE: UIMessage = {
  id: "assistant-complete-usage",
  role: "assistant",
  metadata: {
    usage: {
      inputTokens: 12_800,
      outputTokens: 20,
      totalTokens: 12_820,
      costUsd: 0.01,
      complete: true,
      billing: "usage",
      modelId: GPT_4O_MODEL.id,
      latencyMs: 900,
      status: "completed",
    },
  },
  parts: [{ type: "text", text: "A complete, metered turn." }],
};

/**
 * Complete usage renders exactly as before: no lower-bound marker on the
 * totals, and no uncertainty explanation in the card.
 *
 * @summary complete usage keeps its exact totals and cost
 */
export const CompleteUsageBreakdown: Story = {
  tags: ["ai-generated"],
  args: {
    message: COMPLETE_USAGE_MESSAGE,
    availableModels: [GPT_4O_MODEL],
  },
  play: async ({ canvas }) => {
    const trigger = await waitFor(
      () =>
        canvas.getByRole("button", { name: "Message usage: GPT-4o · 900ms" }),
      { timeout: 15_000 },
    );
    await userEvent.hover(trigger);

    const totalTokensRow = await revealedUsageRow("Total tokens");
    await expect(totalTokensRow).toHaveTextContent("12.8k");

    const costRow = await revealedUsageRow("Est. cost");
    await expect(costRow).toHaveTextContent("$0.010");

    expect(
      screen.queryByText(
        "Recorded usage may not cover all of this Run's spend",
      ),
    ).toBeNull();
  },
};

// ---------------------------------------------------------------------------
// Turn-level actions (turn-actions D13)
// ---------------------------------------------------------------------------

const TURN_RUN_ID = "11111111-1111-4111-8111-111111111111";

/** A latest Run as the history read reports it. */
function turnRun(
  overrides: Partial<ChatLatestRunResponse> = {},
): ChatLatestRunResponse {
  return {
    id: TURN_RUN_ID,
    messageId: "user-turn",
    status: "failed",
    followUpAction: null,
    modelId: "system:openai:gpt-5.4-mini",
    effort: "low",
    permissionMode: "default",
    error: null,
    ...overrides,
  };
}

/** A stored dynamic-tool part plus the classification the api records beside
 *  it; the AI SDK's part union does not declare that extra field. */
type ClassifiedDynamicTool = Extract<
  UIMessage["parts"][number],
  { type: "dynamic-tool" }
> & { classification: string };

/** Adds the classification the api stores beside a settled tool part. */
function storedTool(
  part: Extract<UIMessage["parts"][number], { type: "dynamic-tool" }>,
  classification: string,
): UIMessage["parts"][number] {
  const classified: ClassifiedDynamicTool = { ...part, classification };
  return classified;
}

const SEARCH_TOOL_PART: UIMessage["parts"][number] = {
  type: "dynamic-tool",
  toolCallId: "call-search",
  toolName: "search_conversations",
  state: "output-available",
  input: { query: "budget" },
  output: { status: "success", results: [] },
};

const READ_TOOL_PART = storedTool(
  {
    type: "dynamic-tool",
    toolCallId: "call-read",
    toolName: "read",
    state: "output-available",
    input: { path: "notes.md" },
    output: { status: "success", content: "notes" },
  },
  "read_only",
);

const EDIT_TOOL_PART = storedTool(
  {
    type: "dynamic-tool",
    toolCallId: "call-edit",
    toolName: "edit",
    state: "output-available",
    input: { path: "notes.md" },
    output: { status: "success" },
  },
  "write_low_risk",
);

const BASH_TOOL_PART = storedTool(
  {
    type: "dynamic-tool",
    toolCallId: "call-bash",
    toolName: "bash",
    state: "output-available",
    input: { command: "npm test" },
    output: { status: "success", exitCode: 0 },
  },
  "execute_code",
);

/** A latest reply whose own Run left it unfinished. */
function failedReply(parts: UIMessage["parts"]): UIMessage {
  return {
    id: "assistant-turn",
    role: "assistant",
    parts,
    metadata: { seq: 2, usage: { runId: TURN_RUN_ID, status: "error" } },
  };
}

/** The latest turn's action row reveals through focus, like the per-message
 *  actions: focus the first turn-level button so the row is painted before it
 *  is queried. */
async function revealTurnActions(canvas: PlayContext["canvas"]) {
  const regenerate = await waitFor(
    () => canvas.getByRole("button", { name: "Regenerate" }),
    // The row withholds the transcript until the markdown renderers load.
    { timeout: 15_000 },
  );
  regenerate.focus();
  await waitFor(() => expect(regenerate).toBeVisible());
  return regenerate;
}

/**
 * A failed agentic turn offers both actions: Continue resumes the settled tool
 * step, and Regenerate starts the turn again. Continue sends the composer's
 * permission mode and nothing the Run already owns.
 *
 * @summary a failed agentic turn shows Continue and Regenerate
 */
export const LatestTurnActions: Story = {
  tags: ["ai-generated"],
  args: {
    renderKey: "assistant-turn",
    isLast: true,
    message: failedReply([
      SEARCH_TOOL_PART,
      { type: "text", text: "I found the budget notes." },
    ]),
    latestRun: turnRun(),
  },
  play: async ({ canvas, args }) => {
    await revealTurnActions(canvas);
    const continueTurn = canvas.getByRole("button", { name: "Continue" });
    await expect(continueTurn).toBeVisible();
    await userEvent.click(continueTurn);
    await expect(args.onFollowUp).toHaveBeenCalledWith({
      action: "continue",
      permissionMode: "default",
    });
  },
};

/**
 * A request in flight hides both actions: `regenerate()` has no in-flight
 * guard of its own, so a second request would race the stream that is still
 * writing into the transcript.
 *
 * @summary no actions while a request is in flight
 */
export const LatestTurnActionsHiddenWhileStreaming: Story = {
  tags: ["ai-generated"],
  args: {
    renderKey: "assistant-turn",
    isLast: true,
    status: "streaming",
    message: failedReply([SEARCH_TOOL_PART]),
    latestRun: turnRun({ status: "completed" }),
  },
  play: async ({ canvas }) => {
    await waitFor(
      async () =>
        await expect(
          canvas.getByRole("button", { name: "Fork from here" }),
        ).toBeVisible(),
      { timeout: 15_000 },
    );
    await expect(canvas.queryByRole("button", { name: "Continue" })).toBeNull();
    await expect(
      canvas.queryByRole("button", { name: "Regenerate" }),
    ).toBeNull();
  },
};

/**
 * A failed turn that settled no tool call has no step to resume from, so only
 * Regenerate is offered.
 *
 * @summary Continue is hidden when no tool call settled
 */
export const ContinueHiddenWithoutSettledTool: Story = {
  tags: ["ai-generated"],
  args: {
    renderKey: "assistant-turn",
    isLast: true,
    message: failedReply([{ type: "text", text: "I could not start." }]),
    latestRun: turnRun(),
  },
  play: async ({ canvas }) => {
    await revealTurnActions(canvas);
    await expect(canvas.queryByRole("button", { name: "Continue" })).toBeNull();
  },
};

/**
 * Only the latest turn offers the actions: an older reply keeps its
 * per-message actions and nothing that would act on it again.
 *
 * @summary older turns show no turn-level actions
 */
export const OlderTurnShowsNoActions: Story = {
  tags: ["ai-generated"],
  args: {
    renderKey: "assistant-older",
    isLast: false,
    message: failedReply([SEARCH_TOOL_PART]),
    latestRun: turnRun(),
  },
  play: async ({ canvas }) => {
    await waitFor(
      async () =>
        await expect(
          canvas.getByRole("button", { name: "Fork from here" }),
        ).toBeVisible(),
      { timeout: 15_000 },
    );
    await expect(canvas.queryByRole("button", { name: "Continue" })).toBeNull();
    await expect(
      canvas.queryByRole("button", { name: "Regenerate" }),
    ).toBeNull();
  },
};

/**
 * A plain Regenerate click repeats the Run it replaces — its model, effort,
 * and accepted permission mode — while the composer shows something else.
 *
 * @summary a plain click repeats the latest Run's settings
 */
export const RegenerateRepeatsLatestRun: Story = {
  tags: ["ai-generated"],
  args: {
    renderKey: "assistant-turn",
    isLast: true,
    message: failedReply([
      READ_TOOL_PART,
      { type: "text", text: "Only read-only calls here." },
    ]),
    latestRun: turnRun({
      status: "completed",
      effort: "xhigh",
      permissionMode: "bypass",
    }),
  },
  play: async ({ canvas, args }) => {
    const regenerate = await revealTurnActions(canvas);
    await userEvent.click(regenerate);
    await expect(args.onFollowUp).toHaveBeenCalledWith({
      action: "regenerate",
      modelId: "system:openai:gpt-5.4-mini",
      effort: "xhigh",
      permissionMode: "bypass",
    });
  },
};

/**
 * A reply whose calls could change files or state is not discarded silently:
 * the dialog names those calls and says their effects stay, and a cancel sends
 * nothing.
 *
 * @summary Regenerate names the calls it discards and a cancel sends nothing
 */
export const RegenerateConfirmsDiscardedCalls: Story = {
  tags: ["ai-generated"],
  args: {
    renderKey: "assistant-turn",
    isLast: true,
    message: failedReply([
      EDIT_TOOL_PART,
      BASH_TOOL_PART,
      { type: "text", text: "I edited notes and ran the tests." },
    ]),
    latestRun: turnRun({ status: "completed" }),
  },
  play: async ({ canvas, args }) => {
    args.onFollowUp.mockClear();
    const regenerate = await revealTurnActions(canvas);
    await userEvent.click(regenerate);

    const dialog = await screen.findByRole("alertdialog");
    await expect(dialog).toHaveTextContent("edit");
    await expect(dialog).toHaveTextContent("bash");
    await expect(dialog).toHaveTextContent(
      "Their effects stay, and the new answer will not see them.",
    );

    await userEvent.click(
      within(dialog).getByRole("button", { name: "Cancel" }),
    );
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    await expect(args.onFollowUp).not.toHaveBeenCalled();
  },
};

/**
 * The same confirmation, accepted: the request goes out after the owner
 * confirms.
 *
 * @summary a confirmed Regenerate sends the request
 */
export const RegenerateConfirmedSends: Story = {
  tags: ["ai-generated"],
  args: {
    renderKey: "assistant-turn",
    isLast: true,
    message: failedReply([
      EDIT_TOOL_PART,
      { type: "text", text: "I edited notes." },
    ]),
    latestRun: turnRun({ status: "completed" }),
  },
  play: async ({ canvas, args }) => {
    args.onFollowUp.mockClear();
    const regenerate = await revealTurnActions(canvas);
    await userEvent.click(regenerate);

    const dialog = await screen.findByRole("alertdialog");
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Regenerate" }),
    );
    await expect(args.onFollowUp).toHaveBeenCalledWith({
      action: "regenerate",
      modelId: "system:openai:gpt-5.4-mini",
      effort: "low",
      permissionMode: "default",
    });
  },
};

/**
 * A read-only reply discards nothing whose effects outlive it, so Regenerate
 * sends at once without a dialog.
 *
 * @summary a read-only reply regenerates without a dialog
 */
export const RegenerateReadOnlySkipsDialog: Story = {
  tags: ["ai-generated"],
  args: {
    renderKey: "assistant-turn",
    isLast: true,
    message: failedReply([
      READ_TOOL_PART,
      { type: "text", text: "I read notes." },
    ]),
    latestRun: turnRun({ status: "completed" }),
  },
  play: async ({ canvas, args }) => {
    args.onFollowUp.mockClear();
    const regenerate = await revealTurnActions(canvas);
    await userEvent.click(regenerate);
    await expect(screen.queryByRole("alertdialog")).toBeNull();
    await expect(args.onFollowUp).toHaveBeenCalledWith({
      action: "regenerate",
      modelId: "system:openai:gpt-5.4-mini",
      effort: "low",
      permissionMode: "default",
    });
  },
};

// Base UI's own focus guards (`[data-base-ui-focus-guard]`) are aria-hidden
// spans with tabindex="0", which axe reports as aria-hidden-focus whenever a
// nested popup mounts one. The guards belong to the primitive, not to this
// component, and no call-site markup can fix them — only that rule is
// suppressed here.
const regenerateMenuFocusGuardKnownIssue = {
  a11y: {
    config: {
      rules: [{ id: "aria-hidden-focus", enabled: false }],
    },
  },
};

const MENU_CATALOG = {
  defaultModelId: "system:openai:model-one",
  models: [
    {
      id: "system:openai:model-one",
      source: "system",
      name: "Model One",
      contextWindowTokens: 128_000,
      input: ["text"],
    },
    {
      id: "system:openai:model-three",
      source: "system",
      name: "Model Three",
      contextWindowTokens: 200_000,
      input: ["text"],
    },
  ],
} satisfies { defaultModelId: string; models: Array<AvailableModel> };

/**
 * The Regenerate menu offers the composer's own selectors, so a pick sets the
 * composer, and its submit sends those values.
 *
 * @summary a menu pick sets the composer and submits its values
 */
export const RegenerateMenuSetsTheComposer: Story = {
  tags: ["ai-generated"],
  parameters: regenerateMenuFocusGuardKnownIssue,
  decorators: [
    (Story) => (
      <ChatProvider>
        <Story />
      </ChatProvider>
    ),
  ],
  beforeEach: () => {
    useModelsQueryMock.mockReturnValue({
      data: MENU_CATALOG,
      isError: false,
      isPending: false,
    });
    usePermissionModesQueryMock.mockReturnValue({
      data: { modes: [{ value: "default" }, { value: "bypass" }] },
      isError: false,
      isPending: false,
    });
  },
  args: {
    renderKey: "assistant-turn",
    isLast: true,
    message: failedReply([
      READ_TOOL_PART,
      { type: "text", text: "A read-only reply." },
    ]),
    latestRun: turnRun({ status: "completed" }),
  },
  play: async ({ canvas, args }) => {
    args.onFollowUp.mockClear();
    const trigger = canvas.getByRole("button", {
      name: "Regenerate with other settings",
    });
    trigger.focus();
    await userEvent.click(trigger);

    const menu = await screen.findByRole("dialog", {
      name: "Regenerate settings",
    });
    await userEvent.click(
      within(menu).getByRole("combobox", { name: /Select model/ }),
    );
    await userEvent.click(
      await screen.findByRole("option", { name: /Model Three/ }),
    );

    // The pick wrote the composer: the selector inside the menu now names it.
    await waitFor(() =>
      expect(
        within(menu).getByRole("combobox", { name: /Model Three/ }),
      ).toBeVisible(),
    );

    await userEvent.click(
      within(menu).getByRole("button", {
        name: "Regenerate with these settings",
      }),
    );
    await expect(args.onFollowUp).toHaveBeenCalledWith({
      action: "regenerate",
      modelId: "system:openai:model-three",
      permissionMode: "default",
    });
  },
};

/** The notice the api stores on the user message a Regenerate discarded calls
 *  from (turn-actions D9). */
const REGENERATE_NOTICE_MESSAGE: UIMessage = {
  id: "user-turn",
  role: "user",
  parts: [
    {
      type: "data-context",
      data: {
        v: 1,
        producer: "regenerate",
        form: "notice",
        runId: TURN_RUN_ID,
        payload: { reason: "non_read_only_calls" },
        text: '<system-reminder producer="regenerate" form="notice">discarded</system-reminder>',
      },
    },
    { type: "text", text: "Search my conversations for budget notes." },
  ],
};

/**
 * A user turn whose earlier attempt was discarded carries the regenerate
 * notice, rendered with the transcript's context-item styling. The stored
 * model-facing reminder never surfaces.
 *
 * @summary the regenerate notice renders on its user message
 */
export const RegenerateNoticeOnUserMessage: Story = {
  tags: ["ai-generated"],
  args: {
    renderKey: "user-turn",
    message: REGENERATE_NOTICE_MESSAGE,
  },
  play: async ({ canvas }) => {
    const notice = await waitFor(
      () =>
        canvas.getByText(
          "An earlier attempt at this turn was discarded after it ran tools whose effects stay.",
        ),
      { timeout: 15_000 },
    );
    await expect(notice).toBeVisible();
    expect(canvas.queryByText(/system-reminder/)).toBeNull();
  },
};
