import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, userEvent, within } from "storybook/test";

import { Dialog } from "@workspace/ui/components/dialog";

import type { ProjectResponse } from "@/lib/services/project/types";

import {
  InstructionsEditor,
  ProjectInstructionsSection,
  type InstructionsEditorProps,
} from "./project-instructions-section";

const GUIDANCE = [
  "Write in British English and keep replies short.",
  "Prefer small, reversible changes; explain trade-offs before large ones.",
  "Run the focused tests for whatever you touch, and name the command.",
  "Never push or merge without asking.",
  "Use metric units.",
  "Cite the file and line for every claim about the code.",
  "When unsure, ask one question instead of guessing.",
].join("\n");

const project = (overrides: Partial<ProjectResponse>): ProjectResponse => ({
  id: "p1",
  ownerUserId: "u1",
  name: "Trip planning",
  description: null,
  instructions: null,
  createdAt: "2026-11-01T09:00:00.000Z",
  updatedAt: "2026-11-01T09:00:00.000Z",
  archivedAt: null,
  defaultExecutorId: null,
  ...overrides,
});

const meta = {
  title: "Chat/Projects/Project instructions section",
  component: ProjectInstructionsSection,
  args: { project: project({ instructions: GUIDANCE }) },
  decorators: [
    (Story) => (
      <aside className="w-80 rounded-lg border">
        <Story />
      </aside>
    ),
  ],
} satisfies Meta<typeof ProjectInstructionsSection>;

export default meta;

type Story = StoryObj<typeof meta>;

/** The dialog renders in a portal, outside the story's canvas. */
const page = () => within(document.body);

/**
 * The default: stored instructions as one card, clamped to six lines, whose
 * pencil appears on hover. Selecting the card opens the editor on the
 * stored text with nothing to save yet.
 *
 * @summary stored instructions as a preview that opens the editor
 */
export const Basic: Story = {
  tags: ["ai-generated"],
  play: async ({ canvas }) => {
    await userEvent.click(
      canvas.getByRole("button", { name: "Edit instructions" }),
    );

    const editor = await page().findByRole("textbox", {
      name: "Project instructions",
    });

    await expect(editor).toHaveValue(GUIDANCE);
    await expect(page().getByRole("button", { name: "Save" })).toBeDisabled();
  },
};

/**
 * A project without instructions offers one call to add them.
 *
 * @summary no instructions: an Add instructions call to action
 */
export const Empty: Story = {
  tags: ["ai-generated"],
  args: { project: project({}) },
  play: async ({ canvas }) => {
    await expect(
      canvas.queryByRole("button", { name: "Edit instructions" }),
    ).toBeNull();
    await userEvent.click(
      canvas.getByRole("button", { name: /Add instructions/ }),
    );
    await expect(
      await page().findByRole("textbox", { name: "Project instructions" }),
    ).toHaveValue("");
  },
};

/**
 * An archived project shows its instructions but offers no edit; the editor
 * opens read-only with only Close.
 *
 * @summary archived: read-only instructions
 */
export const Archived: Story = {
  tags: ["ai-generated"],
  args: {
    project: project({
      instructions: GUIDANCE,
      archivedAt: "2026-11-20T09:00:00.000Z",
    }),
  },
  play: async ({ canvas }) => {
    await userEvent.click(
      canvas.getByRole("button", { name: "View instructions" }),
    );
    await expect(
      await page().findByRole("textbox", { name: "Project instructions" }),
    ).toHaveAttribute("readonly");
    await expect(page().queryByRole("button", { name: "Save" })).toBeNull();
  },
};

/**
 * An archived project with no instructions says so and offers nothing.
 *
 * @summary archived and empty: a plain note
 */
export const ArchivedEmpty: Story = {
  tags: ["ai-generated"],
  args: {
    project: project({ archivedAt: "2026-11-20T09:00:00.000Z" }),
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("No instructions.")).toBeVisible();
    await expect(canvas.queryByRole("button")).toBeNull();
  },
};

const editorArgs = {
  stored: GUIDANCE,
  archived: false,
  pending: false,
  failed: false,
  onSave: fn(),
  onClose: fn(),
};

/** The editor on its own, open, for its states. */
const editorMeta = {
  render: (args: InstructionsEditorProps) => (
    <Dialog open>
      <InstructionsEditor {...args} />
    </Dialog>
  ),
};

/**
 * Save stays off until the text differs; Ctrl+Enter saves the literal text.
 *
 * @summary editing enables Save, and Ctrl+Enter saves
 */
export const EditorSavesWithShortcut: StoryObj<typeof InstructionsEditor> = {
  ...editorMeta,
  tags: ["ai-generated"],
  args: editorArgs,
  play: async ({ args }) => {
    const editor = await page().findByRole("textbox", {
      name: "Project instructions",
    });

    await userEvent.type(editor, "\nReply in French.");
    await expect(page().getByRole("button", { name: "Save" })).toBeEnabled();
    await userEvent.keyboard("{Control>}{Enter}{/Control}");
    await expect(args.onSave).toHaveBeenCalledWith(
      `${GUIDANCE}\nReply in French.`,
    );
  },
};
