import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { CopyIcon, RefreshCcwIcon } from "lucide-react";
import { expect, fn } from "storybook/test";

import {
  Message,
  MessageAction,
  MessageActions,
  MessageContent,
  MessageResponse,
} from "./message.js";

// Message is vendored from Vercel AI Elements
// (https://elements.ai-sdk.dev/components/message), not a shadcn component —
// "ai-elements-example" is the AI Elements analog of our "shadcn-example"
// tag. The docs page has exactly one code example, under "Usage with AI
// SDK": a chat UI whose message loop renders, per part,
//   <Message from={message.role}><MessageContent><MessageResponse>
//     {part.text}
//   </MessageResponse></MessageContent></Message>
// and, only for the last assistant turn, a MessageActions row with two
// MessageActions — Retry (RefreshCcwIcon, onClick={() => regenerate()},
// label="Retry") and Copy (CopyIcon, onClick={() =>
// navigator.clipboard.writeText(part.text)}, label="Copy") — both icons
// sized `size-3`. Assistant/User/WithActions below transcribe those two
// fragments (adapted only for: a static string in place of the streamed
// `part.text`/`message.role`, `fn()` mocks in place of `regenerate`/
// `navigator.clipboard`, and our import path); Markdown and
// ActionWithTooltip demonstrate real API surface (Streamdown's Markdown
// support; MessageAction's `tooltip` prop) that the docs' own example never
// exercises, so they carry only "ai-generated". The docs' example also
// composes Conversation/PromptInput, which are out of scope for this file.
// MessageBranch*, MessageAttachment*, and MessageToolbar are unused in this
// app and are intentionally not storied — the docs page likewise never
// shows a MessageAvatar or MessageAttachment usage example despite listing
// them in its feature list.
const meta = {
  component: Message,
  // Full-width: Message is a `w-full` filler whose user/assistant alignment is
  // relative to its parent, so let it span the canvas — the `ml-auto` user
  // bubble sits at the real right edge and the assistant reply at the real
  // left edge. A narrowing decorator (e.g. `mx-auto max-w-3xl`) would float
  // that column mid-canvas and read as misaligned in the visual capture.
  parameters: { layout: "padded" },
  tags: ["autodocs"],
} satisfies Meta<typeof Message>;

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * The core Message composition for an assistant reply — `Message` wrapping
 * `MessageContent` wrapping `MessageResponse` — the exact shape the docs'
 * chat example renders for each streamed text part.
 *
 * Adapted from [AI Elements' Message › Usage with AI SDK](https://elements.ai-sdk.dev/components/message#usage-with-ai-sdk),
 * substituting a static string for the streamed `part.text`.
 *
 * @summary for a plain assistant reply
 */
export const Assistant: Story = {
  tags: ["ai-elements-example", "ai-generated"],
  args: {
    from: "assistant",
    children: (
      <MessageContent>
        <MessageResponse>
          {"Sure — here's a quick summary of what changed in this run."}
        </MessageResponse>
      </MessageContent>
    ),
  },
};

/**
 * The same `Message`/`MessageContent`/`MessageResponse` composition with
 * `from="user"`, which the docs example drives from `message.role` — it
 * renders right-aligned in a filled `bg-secondary` bubble via `Message`'s
 * group state, the visual counterpart to the flush-left assistant reply.
 *
 * Adapted from [AI Elements' Message › Usage with AI SDK](https://elements.ai-sdk.dev/components/message#usage-with-ai-sdk),
 * substituting a static string for the streamed `part.text`.
 *
 * @summary for the right-aligned user bubble
 */
export const User: Story = {
  tags: ["ai-elements-example", "ai-generated"],
  args: {
    from: "user",
    children: (
      <MessageContent>
        <MessageResponse>
          {"Can you summarize what changed in this PR?"}
        </MessageResponse>
      </MessageContent>
    ),
  },
};

/**
 * `MessageResponse` renders full Markdown through Streamdown — headings,
 * emphasis, lists, fenced code, and links — so a model's formatted reply
 * shows up the same whether it just streamed in or is loaded from history.
 * The docs' own example only ever passes plain streamed text, so this
 * richer content has no docs counterpart to transcribe.
 *
 * @summary for a MessageResponse rendering rich Markdown via Streamdown
 */
export const Markdown: Story = {
  tags: ["ai-generated"],
  args: {
    from: "assistant",
    children: (
      <MessageContent>
        <MessageResponse>
          {"## Release notes\n\n" +
            "This update focuses on **durability** and *streaming* correctness.\n\n" +
            "- Runs now persist through worker restarts\n" +
            "- Reconnect resumes an in-flight stream\n\n" +
            "Set `POSTGRES_URL` before running the worker:\n\n" +
            "```bash\n" +
            "export POSTGRES_URL=postgres://localhost/llame\n" +
            "```\n\n" +
            "See the [architecture spec](https://github.com/leon0399/llame/blob/master/SPEC.md) for details."}
        </MessageResponse>
      </MessageContent>
    ),
  },
};

const handleRegenerate = fn();
const handleCopy = fn();

/**
 * `MessageActions` hosting Retry and Copy `MessageAction`s below the last
 * assistant reply — the docs' own chat demo, which wires Retry to
 * `regenerate()` and Copy to `navigator.clipboard.writeText()`.
 *
 * Adapted from [AI Elements' Message › Usage with AI SDK](https://elements.ai-sdk.dev/components/message#usage-with-ai-sdk),
 * substituting `fn()` mocks for `regenerate()`/`navigator.clipboard` so the
 * callbacks are verifiable in isolation.
 *
 * @summary for a message's actions row (retry + copy), as in the docs demo
 */
export const WithActions: Story = {
  tags: ["ai-elements-example", "ai-generated"],
  args: {
    from: "assistant",
    children: (
      <>
        <MessageContent>
          <MessageResponse>
            {"Here's the summary you asked for."}
          </MessageResponse>
        </MessageContent>
        <MessageActions>
          <MessageAction label="Retry" onClick={handleRegenerate}>
            <RefreshCcwIcon className="size-3" />
          </MessageAction>
          <MessageAction label="Copy" onClick={handleCopy}>
            <CopyIcon className="size-3" />
          </MessageAction>
        </MessageActions>
      </>
    ),
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Retry" }));
    await expect(handleRegenerate).toHaveBeenCalledOnce();

    await userEvent.click(canvas.getByRole("button", { name: "Copy" }));
    await expect(handleCopy).toHaveBeenCalledOnce();
  },
};

const handleTooltipAction = fn();

/**
 * `MessageAction` additionally accepts a `tooltip`, shown on hover/focus
 * alongside its `label` accessible name — a real prop from the docs' Props
 * table that its own chat demo never exercises (that demo only sets
 * `label`).
 *
 * @summary for a MessageAction with a visible hover/focus tooltip
 */
export const ActionWithTooltip: Story = {
  tags: ["ai-generated"],
  args: {
    from: "assistant",
    children: (
      <>
        <MessageContent>
          <MessageResponse>
            {"Here's the summary you asked for."}
          </MessageResponse>
        </MessageContent>
        <MessageActions>
          <MessageAction
            label="Copy message"
            onClick={handleTooltipAction}
            tooltip="Copy"
          >
            <CopyIcon />
          </MessageAction>
        </MessageActions>
      </>
    ),
  },
  play: async ({ canvas, userEvent }) => {
    // `label` gives the icon-only action its accessible name (getByRole
    // resolves it) and onClick fires. The tooltip's hover/open behavior is
    // covered by tooltip.stories, so it isn't re-asserted here.
    const button = canvas.getByRole("button", { name: "Copy message" });
    await userEvent.click(button);
    await expect(handleTooltipAction).toHaveBeenCalledOnce();
  },
};
