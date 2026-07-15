import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { Avatar, AvatarFallback, AvatarImage } from "./avatar.js";

const meta = {
  component: Avatar,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
  subcomponents: { AvatarImage, AvatarFallback },
} satisfies Meta<typeof Avatar>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {},
  render: (args) => (
    <Avatar {...args}>
      <AvatarImage src="https://github.com/shadcn.png" alt="@shadcn" />
      <AvatarFallback>CN</AvatarFallback>
    </Avatar>
  ),
};

export const Fallback: Story = {
  args: {},
  render: (args) => (
    <Avatar {...args}>
      <AvatarFallback>CN</AvatarFallback>
    </Avatar>
  ),
};

export const Squared: Story = {
  args: {
    className: "rounded-lg",
  },
  render: (args) => (
    <Avatar {...args}>
      <AvatarImage src="https://github.com/evilrabbit.png" alt="@evilrabbit" />
      <AvatarFallback>ER</AvatarFallback>
    </Avatar>
  ),
};

export const Stacked: Story = {
  args: {},
  render: (args) => (
    <div className="*:data-[slot=avatar]:ring-background flex -space-x-2 *:data-[slot=avatar]:ring-2 *:data-[slot=avatar]:grayscale">
      <Avatar {...args}>
        <AvatarImage src="https://github.com/shadcn.png" alt="@shadcn" />
        <AvatarFallback>CN</AvatarFallback>
      </Avatar>
      <Avatar>
        <AvatarImage src="https://github.com/maxleiter.png" alt="@maxleiter" />
        <AvatarFallback>LR</AvatarFallback>
      </Avatar>
      <Avatar>
        <AvatarImage
          src="https://github.com/evilrabbit.png"
          alt="@evilrabbit"
        />
        <AvatarFallback>ER</AvatarFallback>
      </Avatar>
    </div>
  ),
};
