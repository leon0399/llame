import { PlusIcon } from "lucide-react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, screen, within } from "storybook/test";

import { Button } from "./button.js";
import {
  Avatar,
  AvatarBadge,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
  AvatarImage,
} from "./avatar.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./dropdown-menu.js";

// Most stories here are transcribed from the shadcn Avatar docs examples
// (https://ui.shadcn.com/docs/components/radix/avatar), so the file carries
// the "shadcn-example" provenance tag on each transcribed story. `Fallback` and
// `Squared` document states/usages upstream doesn't (initials-only, squared
// entity avatars) and override with "ai-generated". Upstream example we
// intentionally skip: RTL (excluded by convention). The upstream examples
// currently live outside the registry's indexed examples directory (under
// `apps/v4/examples/radix/`, not `registry/new-york-v4/examples/`), so they
// were pulled directly from the shadcn-ui/ui repo rather than via the shadcn
// MCP's `get_item_examples_from_registries`, which only indexes the latter.
const meta = {
  component: Avatar,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
  subcomponents: {
    AvatarImage,
    AvatarFallback,
    AvatarBadge,
    AvatarGroup,
    AvatarGroupCount,
  },
  argTypes: {
    size: {
      control: "select",
      options: ["default", "sm", "lg"],
      description: "Size of the avatar (and its fallback/badge sizing).",
    },
  },
} satisfies Meta<typeof Avatar>;

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * Use image + fallback initials together so the avatar renders sensibly
 * before, during, and after image load.
 *
 * Verbatim from [shadcn Avatar › Basic](https://ui.shadcn.com/docs/components/radix/avatar#basic).
 *
 * @summary for the standard image avatar with fallback
 */
export const Basic: Story = {
  tags: ["shadcn-example", "ai-generated"],
  args: {
    children: (
      <>
        <AvatarImage
          src="https://github.com/shadcn.png"
          alt="@shadcn"
          className="grayscale"
        />
        <AvatarFallback>CN</AvatarFallback>
      </>
    ),
  },
};

/**
 * Use initials-only when no image URL exists; the fallback is the permanent
 * rendering, not an error state. Upstream doesn't document this state
 * separately from the image+fallback pairing.
 *
 * @summary for users without an avatar image
 */
export const Fallback: Story = {
  tags: ["ai-generated"],
  args: {
    children: <AvatarFallback>CN</AvatarFallback>,
  },
};

/**
 * Use `rounded-lg` for entity/workspace avatars, keeping the default circle
 * for people. Upstream doesn't document this variant as a separate example.
 *
 * @summary for squared non-person avatars
 */
export const Squared: Story = {
  tags: ["ai-generated"],
  args: {
    className: "rounded-lg",
    children: (
      <>
        <AvatarImage
          src="https://github.com/evilrabbit.png"
          alt="@evilrabbit"
        />
        <AvatarFallback>ER</AvatarFallback>
      </>
    ),
  },
};

/**
 * `AvatarBadge` adds a status/notification indicator at the bottom-right of
 * the avatar; use `className` to recolor it (e.g. green for online).
 *
 * Verbatim from [shadcn Avatar › Badge](https://ui.shadcn.com/docs/components/radix/avatar#badge).
 *
 * @summary for a status indicator on the avatar
 */
export const Badge: Story = {
  tags: ["shadcn-example", "ai-generated"],
  args: {
    children: (
      <>
        <AvatarImage src="https://github.com/shadcn.png" alt="@shadcn" />
        <AvatarFallback>CN</AvatarFallback>
        <AvatarBadge className="bg-green-600 dark:bg-green-800" />
      </>
    ),
  },
};

/**
 * `AvatarBadge` can also hold an icon instead of relying on color alone.
 *
 * Verbatim from [shadcn Avatar › Badge with Icon](https://ui.shadcn.com/docs/components/radix/avatar#badge-with-icon).
 *
 * @summary for an icon-based status indicator
 */
export const BadgeWithIcon: Story = {
  tags: ["shadcn-example", "ai-generated"],
  args: {
    className: "grayscale",
    children: (
      <>
        <AvatarImage src="https://github.com/pranathip.png" alt="@pranathip" />
        <AvatarFallback>PP</AvatarFallback>
        <AvatarBadge>
          <PlusIcon />
        </AvatarBadge>
      </>
    ),
  },
};

/**
 * Use `AvatarGroup` to display multiple avatars as a compact, overlapping
 * stack for group membership. Args are spread into every `Avatar`, so the
 * `size` control drives the whole group.
 *
 * Verbatim from [shadcn Avatar › Avatar Group](https://ui.shadcn.com/docs/components/radix/avatar#avatar-group).
 *
 * @summary for compact group membership display
 */
export const Group: Story = {
  tags: ["shadcn-example", "ai-generated"],
  args: {},
  render: (args) => (
    <AvatarGroup className="grayscale">
      <Avatar {...args}>
        <AvatarImage src="https://github.com/shadcn.png" alt="@shadcn" />
        <AvatarFallback>CN</AvatarFallback>
      </Avatar>
      <Avatar {...args}>
        <AvatarImage src="https://github.com/maxleiter.png" alt="@maxleiter" />
        <AvatarFallback>LR</AvatarFallback>
      </Avatar>
      <Avatar {...args}>
        <AvatarImage
          src="https://github.com/evilrabbit.png"
          alt="@evilrabbit"
        />
        <AvatarFallback>ER</AvatarFallback>
      </Avatar>
    </AvatarGroup>
  ),
};

/**
 * Use `AvatarGroupCount` to show how many additional members exist beyond
 * the visible avatars.
 *
 * Verbatim from [shadcn Avatar › Avatar Group Count](https://ui.shadcn.com/docs/components/radix/avatar#avatar-group-count).
 *
 * @summary for a "+N" overflow indicator in a group
 */
export const GroupCount: Story = {
  tags: ["shadcn-example", "ai-generated"],
  args: {},
  render: (args) => (
    <AvatarGroup className="grayscale">
      <Avatar {...args}>
        <AvatarImage src="https://github.com/shadcn.png" alt="@shadcn" />
        <AvatarFallback>CN</AvatarFallback>
      </Avatar>
      <Avatar {...args}>
        <AvatarImage src="https://github.com/maxleiter.png" alt="@maxleiter" />
        <AvatarFallback>LR</AvatarFallback>
      </Avatar>
      <Avatar {...args}>
        <AvatarImage
          src="https://github.com/evilrabbit.png"
          alt="@evilrabbit"
        />
        <AvatarFallback>ER</AvatarFallback>
      </Avatar>
      <AvatarGroupCount>+3</AvatarGroupCount>
    </AvatarGroup>
  ),
};

/**
 * `AvatarGroupCount` can also hold an icon instead of a number.
 *
 * Verbatim from [shadcn Avatar › Avatar Group with Icon](https://ui.shadcn.com/docs/components/radix/avatar#avatar-group-with-icon).
 *
 * @summary for an icon-based overflow indicator in a group
 */
export const GroupCountWithIcon: Story = {
  tags: ["shadcn-example", "ai-generated"],
  args: {},
  render: (args) => (
    <AvatarGroup className="grayscale">
      <Avatar {...args}>
        <AvatarImage src="https://github.com/shadcn.png" alt="@shadcn" />
        <AvatarFallback>CN</AvatarFallback>
      </Avatar>
      <Avatar {...args}>
        <AvatarImage src="https://github.com/maxleiter.png" alt="@maxleiter" />
        <AvatarFallback>LR</AvatarFallback>
      </Avatar>
      <Avatar {...args}>
        <AvatarImage
          src="https://github.com/evilrabbit.png"
          alt="@evilrabbit"
        />
        <AvatarFallback>ER</AvatarFallback>
      </Avatar>
      <AvatarGroupCount>
        <PlusIcon />
      </AvatarGroupCount>
    </AvatarGroup>
  ),
};

/**
 * The size scale — `sm`, default, and `lg`. `size` is fixed per avatar in
 * this showcase, so its control is disabled here (the row stays visible,
 * just not editable).
 *
 * Adapted from [shadcn Avatar › Sizes](https://ui.shadcn.com/docs/components/radix/avatar#sizes)
 * (upstream renders three separate `Avatar`s with a hardcoded `size` each;
 * here each is spread with `{...args}` so shared controls still apply).
 *
 * @summary reference of the avatar size scale
 */
export const Sizes: Story = {
  tags: ["shadcn-example", "ai-generated"],
  args: {},
  argTypes: {
    size: { control: false },
  },
  render: (args) => (
    <div className="flex flex-wrap items-center gap-2 grayscale">
      <Avatar {...args} size="sm">
        <AvatarImage src="https://github.com/shadcn.png" alt="@shadcn" />
        <AvatarFallback>CN</AvatarFallback>
      </Avatar>
      <Avatar {...args}>
        <AvatarImage src="https://github.com/shadcn.png" alt="@shadcn" />
        <AvatarFallback>CN</AvatarFallback>
      </Avatar>
      <Avatar {...args} size="lg">
        <AvatarImage src="https://github.com/shadcn.png" alt="@shadcn" />
        <AvatarFallback>CN</AvatarFallback>
      </Avatar>
    </div>
  ),
};

/**
 * Use the avatar as a dropdown menu trigger for account actions; the play
 * function verifies the menu opens with its items.
 *
 * Verbatim from [shadcn Avatar › Dropdown](https://ui.shadcn.com/docs/components/radix/avatar#dropdown).
 *
 * @summary for an avatar that triggers an account menu
 */
export const Dropdown: Story = {
  tags: ["shadcn-example", "ai-generated"],
  args: {},
  // Radix's dropdown portal leaves a stale aria-hidden wrapper with focusable
  // remnants after interaction — a known false positive, not a real semantic
  // issue in this story (see dropdown-menu.stories.tsx, which disables the
  // same rule for the same primitive).
  parameters: {
    a11y: {
      config: {
        rules: [{ id: "aria-hidden-focus", enabled: false }],
      },
    },
  },
  render: (args) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="rounded-full">
          <Avatar {...args}>
            <AvatarImage src="https://github.com/shadcn.png" alt="shadcn" />
            <AvatarFallback>CN</AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-32">
        <DropdownMenuGroup>
          <DropdownMenuItem>Profile</DropdownMenuItem>
          <DropdownMenuItem>Billing</DropdownMenuItem>
          <DropdownMenuItem>Settings</DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem variant="destructive">Log out</DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  ),
  play: async ({ canvas, userEvent }) => {
    const trigger = canvas.getByRole("button");
    await userEvent.click(trigger);

    const menu = await screen.findByRole("menu");
    await expect(within(menu).getByText("Profile")).toBeInTheDocument();
    await expect(within(menu).getByText("Log out")).toBeInTheDocument();
  },
};
