import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { Avatar, AvatarFallback, AvatarImage } from "./avatar.js";

const meta = {
  component: Avatar,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs", "ai-generated"],
  subcomponents: { AvatarImage, AvatarFallback },
} satisfies Meta<typeof Avatar>;

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * Use image + fallback initials together so the avatar renders sensibly
 * before, during, and after image load.
 *
 * @summary for the standard image avatar with fallback
 */
export const Basic: Story = {
  args: {},
  render: (args) => (
    <Avatar {...args}>
      <AvatarImage src="https://github.com/shadcn.png" alt="@shadcn" />
      <AvatarFallback>CN</AvatarFallback>
    </Avatar>
  ),
};

/**
 * Use initials-only when no image URL exists; the fallback is the permanent
 * rendering, not an error state.
 *
 * @summary for users without an avatar image
 */
export const Fallback: Story = {
  args: {},
  render: (args) => (
    <Avatar {...args}>
      <AvatarFallback>CN</AvatarFallback>
    </Avatar>
  ),
};

/**
 * Use `rounded-lg` for entity/workspace avatars, keeping the default circle
 * for people.
 *
 * @summary for squared non-person avatars
 */
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

/**
 * Use the overlapping stack to summarize a group compactly; the ring color
 * matches the background so members stay visually separated.
 *
 * @summary for compact group membership display
 */
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
