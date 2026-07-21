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
import { contrastKnownIssue232 } from "./known-a11y-issues.js";

// Most stories here are transcribed from the shadcn Avatar docs examples
// (https://ui.shadcn.com/docs/components/base/avatar), so the file carries
// the "shadcn-example" provenance tag on each transcribed story. `Fallback` and
// `Squared` document states/usages upstream doesn't (initials-only, squared
// entity avatars) and override with "ai-generated". Upstream example we
// intentionally skip: RTL (excluded by convention). The base-nova examples
// live in the shadcn-ui/ui repo under `apps/v4/examples/base/` and were pulled
// directly from there.
const meta = {
  component: Avatar,
  parameters: {
    layout: "centered",
    // #232 — base-nova's AvatarFallback / AvatarGroupCount use
    // `text-muted-foreground` on `bg-muted` (~4.34:1), below WCAG AA. The
    // fallback is only visible when the avatar image fails to load, so the
    // color-contrast failure is nondeterministic per story; suppress file-wide
    // until the #232 token fix lands (our pre-migration fork used
    // `text-foreground` and avoided this).
    ...contrastKnownIssue232,
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
 * Verbatim from [shadcn Avatar › Basic](https://ui.shadcn.com/docs/components/base/avatar#basic).
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
 * for people. Base UI's avatar clips the image via `rounded-full` on the
 * Image/Fallback themselves (and an `after:` ring on the Root), so squaring
 * one means overriding the radius on all of them, not just the Root. Upstream
 * doesn't document this variant as a separate example.
 *
 * TODO: add a `shape="round" | "square"` prop to `Avatar` that toggles the
 * radius across the Root, its `after:` ring, and the Image/Fallback together,
 * so consumers stop hand-overriding `rounded-*` on every part. The same
 * pattern already appears in `app-sidebar-user.tsx` (which currently squares
 * only Root + Fallback, leaving the `after:` ring round). Replace this story's
 * manual overrides with the prop once it lands.
 *
 * @summary for squared non-person avatars
 */
export const Squared: Story = {
  tags: ["ai-generated"],
  args: {
    className: "rounded-lg after:rounded-lg",
    children: (
      <>
        <AvatarImage
          src="https://github.com/evilrabbit.png"
          alt="@evilrabbit"
          className="rounded-lg"
        />
        <AvatarFallback className="rounded-lg">ER</AvatarFallback>
      </>
    ),
  },
};

/**
 * `AvatarBadge` adds a status/notification indicator at the bottom-right of
 * the avatar; use `className` to recolor it (e.g. green for online).
 *
 * Verbatim from [shadcn Avatar › Badge](https://ui.shadcn.com/docs/components/base/avatar#badge).
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
 * Verbatim from [shadcn Avatar › Badge with Icon](https://ui.shadcn.com/docs/components/base/avatar#badge-with-icon).
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
 * Verbatim from [shadcn Avatar › Avatar Group](https://ui.shadcn.com/docs/components/base/avatar#avatar-group).
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
 * Verbatim from [shadcn Avatar › Avatar Group Count](https://ui.shadcn.com/docs/components/base/avatar#avatar-group-count).
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
 * Verbatim from [shadcn Avatar › Avatar Group with Icon](https://ui.shadcn.com/docs/components/base/avatar#avatar-group-with-icon).
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
 * Adapted from [shadcn Avatar › Sizes](https://ui.shadcn.com/docs/components/base/avatar#sizes)
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
 * Verbatim from [shadcn Avatar › Dropdown](https://ui.shadcn.com/docs/components/base/avatar#dropdown).
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
