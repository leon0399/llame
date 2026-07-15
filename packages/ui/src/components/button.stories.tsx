import { PlusIcon } from "lucide-react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn } from "storybook/test";

import { Button } from "./button.js";

const meta = {
  component: Button,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
  argTypes: {
    asChild: {
      control: false,
      description: "Whether to render as a Slot component",
    },
  },
  args: {
    onClick: fn(),
  },
} satisfies Meta<typeof Button>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    children: "Button",
  },
  play: async ({ args, canvas, userEvent }) => {
    const button = canvas.getByRole("button");

    await expect(button).toBeInTheDocument();
    await userEvent.click(button);
    expect(args.onClick).toHaveBeenCalledOnce();
  },
};

export const WithIcon: Story = {
  args: {
    children: (
      <>
        <PlusIcon />
        Add Item
      </>
    ),
  },
};

export const Icon: Story = {
  args: {
    "aria-label": "Add item",
    children: <PlusIcon />,
    size: "icon",
  },
};

export const Variants: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      <Button>Default</Button>
      <Button variant="destructive">Destructive</Button>
      <Button variant="outline">Outline</Button>
      <Button variant="secondary">Secondary</Button>
      <Button variant="ghost">Ghost</Button>
      <Button variant="link">Link</Button>
    </div>
  ),
};
