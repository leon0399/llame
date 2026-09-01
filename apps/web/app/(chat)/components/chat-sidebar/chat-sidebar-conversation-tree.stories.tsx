import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { SidebarProvider } from "@workspace/ui/components/sidebar";
import { expect, within } from "storybook/test";

import { ChatSidebarConversationTree } from "./chat-sidebar-conversation-tree";

const meta = {
  component: ChatSidebarConversationTree,
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      // Width-only frame matching the real chat-sidebar's --sidebar-width
      // (see chat-sidebar/index.tsx); SidebarProvider is the required
      // ancestor for the sidebar primitives this component composes.
      <SidebarProvider className="min-h-0 w-fit">
        <div className="w-[20rem] p-2">
          <Story />
        </div>
      </SidebarProvider>
    ),
  ],
  parameters: { layout: "centered" },
} satisfies Meta<typeof ChatSidebarConversationTree>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * The component seeds its own sample graph — no live conversation source is
 * wired up yet (see the component's own comment) — so the default story
 * needs no args or mocks. The default selection is the branch-merge node,
 * which keeps every sample item visible rather than dimming one branch.
 *
 * @summary the sample conversation tree, expanded with every node visible
 */
export const Basic: Story = {
  tags: ["ai-generated"],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByText("Conversation History")).toBeInTheDocument();

    // Untruncated sample content (<=40 chars) from both the "main" and
    // "branch-1" branches, proving the merge-node default selection keeps
    // both branches visible.
    await expect(
      canvas.getByRole("button", {
        name: "You: Can you help me analyze this dataset?",
      }),
    ).toBeInTheDocument();
    await expect(
      canvas.getByRole("button", {
        name: "Agent: Running data profiling agent...",
      }),
    ).toBeInTheDocument();
  },
};
