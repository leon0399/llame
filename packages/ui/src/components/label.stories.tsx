import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect } from "storybook/test";

import { Input } from "./input.js";
import { Label } from "./label.js";

// The shadcn Label docs (https://ui.shadcn.com/docs/components/radix/label)
// have exactly one non-RTL example, label-demo, and it pairs Label with
// Checkbox — a component we do not vendor, so it can't be transcribed
// verbatim. label-rtl is skipped by convention. In its place we pair Label
// with our vendored Input via `htmlFor`/`id`, the same association the docs'
// own "Usage" snippet shows (`<Label htmlFor="email">…</Label>`) and the
// pattern our switch.stories.tsx Basic story already exercises for Switch.
// Since this isn't a verbatim upstream example, the story carries
// "ai-generated" rather than "shadcn-example".
const meta = {
  component: Label,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs", "ai-generated"],
} satisfies Meta<typeof Label>;

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * Associate a label with a form control via `htmlFor`/`id` so clicking the
 * label text focuses the control — the standard accessible labelling pattern
 * for any field.
 *
 * @summary for the default labelled form control
 */
export const Basic: Story = {
  render: () => (
    <div className="grid gap-2">
      <Label htmlFor="email">Your email address</Label>
      <Input id="email" type="email" placeholder="you@example.com" />
    </div>
  ),
  play: async ({ canvas, userEvent }) => {
    const label = canvas.getByText("Your email address");
    const input = canvas.getByRole("textbox", {
      name: "Your email address",
    });

    await expect(input).not.toHaveFocus();
    await userEvent.click(label);
    await expect(input).toHaveFocus();
  },
};
