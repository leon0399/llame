import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { MessageSquareIcon } from "lucide-react";
import { expect, within } from "storybook/test";

import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "./conversation.js";
import { Message, MessageContent, MessageResponse } from "./message.js";

// Both stories below transcribe the AI Elements Conversation docs' single
// "Usage with AI SDK" example
// (https://elements.ai-sdk.dev/components/conversation#usage-with-ai-sdk), so
// they carry the "ai-elements-example" provenance tag. Adapted:
// - `useChat()` and its `messages.map(...)` loop are replaced with a static
//   message list — a story has no backend to stream from, so this is the
//   framework substitution (like `next/link` -> `<a>` for shadcn examples).
// - The `<PromptInput>` block is dropped entirely: it is a separate AI
//   Elements component we have not vendored, so it is out of scope here.
// - `<ConversationDownload messages={messages} />` is dropped: it does not
//   exist in our vendored `conversation.tsx` (a real API gap vs. upstream,
//   not a deliberate adaptation) — flagging it as the "how outdated are we"
//   signal per packages/ui/AGENTS.md.
// - The page-level wrapper (`max-w-4xl mx-auto p-6 ... h-[600px]`) is
//   replaced by this file's fixed-height decorator, matching how inline
//   shadcn examples are re-framed for our docs canvas.
const meta = {
  component: Conversation,
  // Full-width: Conversation is a full-width scroll region, so let it span the
  // canvas. The decorator only bounds the stick-to-bottom scroll height — no
  // width narrowing, which would float the transcript in the wider capture.
  parameters: { layout: "padded" },
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <div className="h-[24rem]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Conversation>;

export default meta;
type Story = StoryObj<typeof Conversation>;

/**
 * A transcript of alternating user and assistant messages inside a bounded
 * height container. The container auto-sticks to the bottom as content is
 * added and stays scrollable so the reader can review earlier turns.
 *
 * Verbatim from [AI Elements Conversation › Usage with AI SDK](https://elements.ai-sdk.dev/components/conversation#usage-with-ai-sdk).
 *
 * @summary for a scrollable transcript of alternating messages
 */
export const Basic: Story = {
  tags: ["ai-elements-example", "ai-generated"],
  render: (args) => (
    <Conversation {...args} aria-label="Conversation transcript">
      <ConversationContent>
        <Message from="user">
          <MessageContent>
            <MessageResponse>What is the capital of France?</MessageResponse>
          </MessageContent>
        </Message>
        <Message from="assistant">
          <MessageContent>
            <MessageResponse>The capital of France is Paris.</MessageResponse>
          </MessageContent>
        </Message>
        <Message from="user">
          <MessageContent>
            <MessageResponse>And what is its population?</MessageResponse>
          </MessageContent>
        </Message>
        <Message from="assistant">
          <MessageContent>
            <MessageResponse>
              Paris has a population of roughly 2.1 million people within the
              city proper.
            </MessageResponse>
          </MessageContent>
        </Message>
      </ConversationContent>
      <ConversationScrollButton />
    </Conversation>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("log", { name: "Conversation transcript" }),
    ).toBeInTheDocument();
    await expect(canvas.getAllByText(/paris/i).length).toBeGreaterThan(0);
  },
};

/**
 * Shown in place of `ConversationContent`'s messages before any exist, so a
 * fresh chat doesn't render an empty scroll area.
 *
 * Verbatim from [AI Elements Conversation › Usage with AI SDK](https://elements.ai-sdk.dev/components/conversation#usage-with-ai-sdk)
 * — the example's `messages.length === 0` branch.
 *
 * @summary for the "no messages yet" placeholder before a chat has content
 */
export const Empty: Story = {
  tags: ["ai-elements-example", "ai-generated"],
  render: (args) => (
    <Conversation {...args} aria-label="Conversation transcript">
      <ConversationContent>
        <ConversationEmptyState
          description="Type a message below to begin chatting"
          icon={<MessageSquareIcon className="size-12" />}
          title="Start a conversation"
        />
      </ConversationContent>
    </Conversation>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Start a conversation")).toBeInTheDocument();
    await expect(
      canvas.getByText("Type a message below to begin chatting"),
    ).toBeInTheDocument();
  },
};
