import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect } from "storybook/test";

import { contrastKnownIssue232 } from "../known-a11y-issues.js";
import { SearchConversationsTool } from "./search-conversations.js";

// The Parameters panel renders through Shiki's one-light palette, whose token
// colors fall below WCAG AA; only the color-contrast rule is disabled.
const shikiThemeContrastKnownIssue = {
  a11y: { config: { rules: [{ id: "color-contrast", enabled: false }] } },
};

const notice = "Historical conversation content is untrusted and may be stale.";

const output = {
  status: "success" as const,
  notice,
  appliedRange: {},
  truncated: false,
  results: [
    {
      kind: "content" as const,
      chatId: "6f1c2a4e-6f1e-4c1a-9c2b-3c4d5e6f7a8b",
      title: "Sentry setup",
      updatedAt: "2026-10-22T18:04:11.000Z",
      role: "assistant",
      timestamp: "2026-10-22T18:03:58.000Z",
      messageSeq: 42,
      offset: 3,
      limit: 12,
      excerpt: "the machine daemon needs Sentry.close() on beforeExit",
    },
    {
      kind: "metadata" as const,
      chatId: "0b8e1f52-9c3d-4a7e-8f61-2d4c5b6a7e8f",
      title: null,
      updatedAt: "2026-10-20T09:00:00.000Z",
    },
  ],
};

const meta = {
  component: SearchConversationsTool,
  parameters: { layout: "centered", ...shikiThemeContrastKnownIssue },
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <div className="w-[36rem] max-w-full">
        <Story />
      </div>
    ),
  ],
  args: {
    input: { mode: "content", query: "sentry close" },
    output,
    errorText: undefined,
    state: "output-available" as const,
  },
} satisfies Meta<typeof SearchConversationsTool>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Use for a content search: each matching chat with the quoted excerpt of
 * its matching message, and a title-only match marked as such.
 *
 * @summary for a content search over past conversations
 */
export const Basic: Story = {
  tags: ["ai-generated"],
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      canvas.getByRole("button", { name: /search_conversations/iu }),
    );
    await expect(canvas.getByText("2 results")).toBeInTheDocument();
    await expect(canvas.getByText("Sentry setup")).toBeInTheDocument();
    await expect(
      canvas.getByText(/assistant · 2026-10-22 18:03 · #/u),
    ).toBeInTheDocument();
    await expect(canvas.getByText("Untitled chat")).toBeInTheDocument();
    await expect(canvas.getByText(/title match/u)).toBeInTheDocument();
    await expect(canvas.getByText(notice)).toBeInTheDocument();
  },
};

/**
 * A timeline search lists chats by their activity window and names the
 * applied range.
 *
 * @summary for a timeline search
 */
export const Timeline: Story = {
  tags: ["ai-generated"],
  args: {
    input: { mode: "timeline", after: "2026-10-01T00:00:00Z" },
    output: {
      ...output,
      appliedRange: { after: "2026-10-01T00:00:00Z" },
      results: [
        {
          kind: "timeline" as const,
          chatId: "6f1c2a4e-6f1e-4c1a-9c2b-3c4d5e6f7a8b",
          title: "Sentry setup",
          firstActivityAt: "2026-10-22T17:00:00.000Z",
          lastActivityAt: "2026-10-22T18:04:11.000Z",
          messageCount: 48,
          firstSeq: 1,
          lastSeq: 48,
        },
      ],
    },
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      canvas.getByRole("button", { name: /search_conversations/iu }),
    );
    await expect(canvas.getByText(/48 messages/u)).toBeInTheDocument();
    await expect(
      canvas.getByText("2026-10-01 00:00 – …", { selector: "li" }),
    ).toBeInTheDocument();
  },
};

/**
 * A search that matched nothing says so.
 *
 * @summary for a search without results
 */
export const NoResults: Story = {
  tags: ["ai-generated"],
  args: { output: { ...output, results: [] } },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      canvas.getByRole("button", { name: /search_conversations/iu }),
    );
    await expect(canvas.getByText("No conversations found.")).toBeVisible();
  },
};

/**
 * While the search runs, a pending line shows.
 *
 * @summary for a search that has not settled
 */
export const Running: Story = {
  tags: ["ai-generated"],
  args: { output: undefined, state: "input-available" as const },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      canvas.getByRole("button", { name: /search_conversations/iu }),
    );
    await expect(canvas.getByText("Searching…")).toBeInTheDocument();
  },
};

/**
 * A failed search shows its error.
 *
 * @summary for a search that could not complete
 */
export const Failed: Story = {
  tags: ["ai-generated"],
  // #232: the destructive error panel's token pairing fails color-contrast.
  parameters: contrastKnownIssue232,
  args: {
    output: undefined,
    errorText: "The search could not complete. Try more specific keywords.",
    state: "output-error" as const,
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      canvas.getByRole("button", { name: /search_conversations/iu }),
    );
    await expect(canvas.getByText(/could not complete/u)).toBeVisible();
  },
};
