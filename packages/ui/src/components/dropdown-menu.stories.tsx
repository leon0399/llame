import * as React from "react";
import {
  BadgeCheckIcon,
  BellIcon,
  Building2Icon,
  CreditCardIcon,
  DownloadIcon,
  EyeIcon,
  FileCodeIcon,
  FileIcon,
  FileTextIcon,
  FolderIcon,
  FolderOpenIcon,
  FolderSearchIcon,
  HelpCircleIcon,
  KeyboardIcon,
  LanguagesIcon,
  LayoutIcon,
  LogOutIcon,
  MailIcon,
  MessageSquareIcon,
  MonitorIcon,
  MoonIcon,
  MoreHorizontalIcon,
  PaletteIcon,
  PencilIcon,
  SaveIcon,
  SettingsIcon,
  ShareIcon,
  ShieldIcon,
  SunIcon,
  TrashIcon,
  UserIcon,
  WalletIcon,
} from "lucide-react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, screen, waitFor, within } from "storybook/test";

import { Avatar, AvatarFallback, AvatarImage } from "./avatar.js";
import { Button } from "./button.js";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "./dropdown-menu.js";

// This file is mixed provenance: `shadcn-example` (the meta default below)
// for stories transcribed from the shadcn Dropdown Menu docs
// (https://ui.shadcn.com/docs/components/radix/dropdown-menu); no story
// overrides the tag to `ai-generated` — every documented example turned out
// compatible with our component (see below).
//
// CORRECTED (this sweep): a prior pass only checked the stale
// `new-york-v4/examples/` registry (mostly 404 there now), found three
// matching files, and wrongly logged everything else as
// `radix-nova`-only/incompatible. The actual source for every current
// example is `apps/v4/examples/radix/<comp>-<x>.tsx` — the same files the
// docs page's own "Radix UI" tab renders — and they compose the standard
// Radix API our component already exports. Fetched and transcribed all 11
// non-RTL sections: Basic, Submenu, Shortcuts, Icons, Checkboxes, Checkboxes
// Icons, Radio Group, Radio Icons, Destructive, Avatar, Complex. RTL is
// skipped by convention. No API gap: every subcomponent/prop these examples
// use (including `DropdownMenuItem`'s `variant="destructive"` and the
// checkbox/radio group state props) already exists on our component.
//
// The page's own hero preview (`dropdown-menu-demo`, unanchored, shown above
// "## Installation") is NOT given its own story: its content is a strict
// superset of the Basic + Submenu + Shortcuts sections combined (grouped
// items, a nested submenu, and shortcut hints, all in one menu) — same
// precedent as `avatar-demo` in avatar.stories.tsx. The previous "Basic"
// story here was actually transcribed from that hero, not from the real
// `#basic` anchor's (simpler) example; its submenu-focused `play` test moved
// to the new `Submenu` story below, and `Basic` now renders the actual
// upstream Basic example.
//
// Note: our `DropdownMenuRadioItem` is an intentional fork (see its comment
// in dropdown-menu.tsx) — selection is marked with a trailing CheckIcon on
// the right, not upstream's leading dot. `RadioGroup`/`RadioIcons` below are
// still `shadcn-example` (the composition is verbatim), but their rendered
// selection indicator differs from what upstream's own screenshot shows.
//
// `AvatarMenu` below transcribes this page's own "#avatar" anchor example
// (an Avatar used as the trigger for an account menu) — a different upstream
// example, with different menu contents, from Avatar's own "Dropdown" story
// in avatar.stories.tsx (which transcribes avatar.mdx's "#dropdown" anchor).
// The story is named `AvatarMenu` rather than `Avatar` to avoid colliding
// with the imported `Avatar` component identifier.
const meta = {
  component: DropdownMenu,
  subcomponents: {
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuPortal,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuSeparator,
    DropdownMenuShortcut,
    DropdownMenuSub,
    DropdownMenuSubContent,
    DropdownMenuSubTrigger,
    DropdownMenuTrigger,
  },
  parameters: {
    layout: "centered",
    a11y: {
      config: {
        // Radix portals DropdownMenuContent outside the trigger's DOM
        // subtree and toggles `aria-hidden` on the rest of the page while
        // open. axe's aria-hidden-focus rule then flags the still-mounted
        // (but visually hidden) trigger/canvas root as a focusable element
        // inside an aria-hidden container — a false positive specific to
        // the portal + jsdom test environment, not a real browser issue.
        rules: [{ id: "aria-hidden-focus", enabled: false }],
      },
    },
  },
  tags: ["autodocs"],
  argTypes: {},
} satisfies Meta<typeof DropdownMenu>;

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * Use for a simple list of grouped actions, with a disabled item to mark one
 * as unavailable; the play function verifies the disabled item's state.
 *
 * Verbatim from [shadcn Dropdown Menu › Basic](https://ui.shadcn.com/docs/components/radix/dropdown-menu#basic).
 *
 * @summary for a simple list of grouped actions
 */
export const Basic: Story = {
  tags: ["shadcn-example", "ai-generated"],
  args: {},
  render: (args) => (
    <DropdownMenu {...args}>
      <DropdownMenuTrigger asChild>
        <Button variant="outline">Open</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuGroup>
          <DropdownMenuLabel>My Account</DropdownMenuLabel>
          <DropdownMenuItem>Profile</DropdownMenuItem>
          <DropdownMenuItem>Billing</DropdownMenuItem>
          <DropdownMenuItem>Settings</DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem>GitHub</DropdownMenuItem>
        <DropdownMenuItem>Support</DropdownMenuItem>
        <DropdownMenuItem disabled>API</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  ),
  play: async ({ canvas, userEvent }) => {
    const triggerButton = canvas.getByText("Open");
    await expect(triggerButton).toBeInTheDocument();

    await userEvent.click(triggerButton);
    const dropdown = screen.getByRole("menu");
    await expect(dropdown).toBeInTheDocument();

    const apiItem = within(dropdown).getByRole("menuitem", { name: "API" });
    await expect(apiItem).toHaveAttribute("aria-disabled", "true");
  },
};

/**
 * Use DropdownMenuSub to nest actions under a parent item, any number of
 * levels deep; the play function verifies both levels of this example open.
 * Relocated from the previous (mislabeled) "Basic" story once the real
 * upstream Basic example — simpler, no submenu — was identified.
 *
 * Verbatim from [shadcn Dropdown Menu › Submenu](https://ui.shadcn.com/docs/components/radix/dropdown-menu#submenu).
 *
 * @summary for actions nested in a submenu
 */
export const Submenu: Story = {
  tags: ["shadcn-example", "ai-generated"],
  args: {},
  render: (args) => (
    <DropdownMenu {...args}>
      <DropdownMenuTrigger asChild>
        <Button variant="outline">Open</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuGroup>
          <DropdownMenuItem>Team</DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Invite users</DropdownMenuSubTrigger>
            <DropdownMenuPortal>
              <DropdownMenuSubContent>
                <DropdownMenuItem>Email</DropdownMenuItem>
                <DropdownMenuItem>Message</DropdownMenuItem>
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>More options</DropdownMenuSubTrigger>
                  <DropdownMenuPortal>
                    <DropdownMenuSubContent>
                      <DropdownMenuItem>Calendly</DropdownMenuItem>
                      <DropdownMenuItem>Slack</DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem>Webhook</DropdownMenuItem>
                    </DropdownMenuSubContent>
                  </DropdownMenuPortal>
                </DropdownMenuSub>
                <DropdownMenuSeparator />
                <DropdownMenuItem>Advanced...</DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuPortal>
          </DropdownMenuSub>
          <DropdownMenuItem>
            New Team <DropdownMenuShortcut>⌘+T</DropdownMenuShortcut>
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  ),
  play: async ({ canvas, userEvent }) => {
    const triggerButton = canvas.getByText("Open");
    await expect(triggerButton).toBeInTheDocument();

    await userEvent.click(triggerButton);
    const dropdown = screen.getByRole("menu");
    await expect(dropdown).toBeInTheDocument();

    const inviteUsersItem = within(dropdown).getByText("Invite users");
    await expect(inviteUsersItem).toBeInTheDocument();
    await userEvent.click(inviteUsersItem);

    const emailItem = await screen.findByText("Email");
    await expect(emailItem).toBeInTheDocument();
    await waitFor(() => expect(emailItem).toBeVisible());

    const moreOptionsItem = screen.getByText("More options");
    await userEvent.click(moreOptionsItem);

    const calendlyItem = await screen.findByText("Calendly");
    await expect(calendlyItem).toBeInTheDocument();
    await waitFor(() => expect(calendlyItem).toBeVisible());
  },
};

/**
 * Use DropdownMenuShortcut to display a keyboard shortcut hint beside an
 * item — it's presentational only and doesn't wire up the actual keybinding.
 *
 * Verbatim from [shadcn Dropdown Menu › Shortcuts](https://ui.shadcn.com/docs/components/radix/dropdown-menu#shortcuts).
 *
 * @summary for items with a keyboard shortcut hint
 */
export const Shortcuts: Story = {
  tags: ["shadcn-example", "ai-generated"],
  args: {},
  render: (args) => (
    <DropdownMenu {...args}>
      <DropdownMenuTrigger asChild>
        <Button variant="outline">Open</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuGroup>
          <DropdownMenuLabel>My Account</DropdownMenuLabel>
          <DropdownMenuItem>
            Profile <DropdownMenuShortcut>⇧⌘P</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem>
            Billing <DropdownMenuShortcut>⌘B</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem>
            Settings <DropdownMenuShortcut>⌘S</DropdownMenuShortcut>
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem>
          Log out <DropdownMenuShortcut>⇧⌘Q</DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  ),
};

/**
 * Use a leading icon on DropdownMenuItem to reinforce each action's meaning
 * at a glance; `variant="destructive"` still recolors the icon via its own
 * CSS selector, no extra prop needed.
 *
 * Verbatim from [shadcn Dropdown Menu › Icons](https://ui.shadcn.com/docs/components/radix/dropdown-menu#icons).
 *
 * @summary for items with a leading icon
 */
export const Icons: Story = {
  tags: ["shadcn-example", "ai-generated"],
  args: {},
  render: (args) => (
    <DropdownMenu {...args}>
      <DropdownMenuTrigger asChild>
        <Button variant="outline">Open</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem>
          <UserIcon />
          Profile
        </DropdownMenuItem>
        <DropdownMenuItem>
          <CreditCardIcon />
          Billing
        </DropdownMenuItem>
        <DropdownMenuItem>
          <SettingsIcon />
          Settings
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive">
          <LogOutIcon />
          Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  ),
};

/**
 * Use DropdownMenuCheckboxItem for independent toggles whose state persists
 * across menu open/close; the play function verifying the round-trip is our
 * own overlay on top of the upstream example.
 *
 * Verbatim from [shadcn Dropdown Menu › Checkboxes](https://ui.shadcn.com/docs/components/radix/dropdown-menu#checkboxes).
 *
 * @summary for independent toggle items
 */
export const Checkboxes: Story = {
  tags: ["shadcn-example", "ai-generated"],
  render: function CheckboxesRender() {
    const [showStatusBar, setShowStatusBar] = React.useState(true);
    const [showActivityBar, setShowActivityBar] = React.useState(false);
    const [showPanel, setShowPanel] = React.useState(false);

    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline">Open</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-40">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Appearance</DropdownMenuLabel>
            <DropdownMenuCheckboxItem
              checked={showStatusBar ?? false}
              onCheckedChange={setShowStatusBar}
            >
              Status Bar
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={showActivityBar}
              onCheckedChange={setShowActivityBar}
              disabled
            >
              Activity Bar
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={showPanel}
              onCheckedChange={setShowPanel}
            >
              Panel
            </DropdownMenuCheckboxItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  },
  play: async ({ canvas, userEvent }) => {
    const triggerButton = canvas.getByText("Open");
    await userEvent.click(triggerButton);

    const dropdown = screen.getByRole("menu");
    const statusBarItem = within(dropdown).getByRole("menuitemcheckbox", {
      name: "Status Bar",
    });
    const activityBarItem = within(dropdown).getByRole("menuitemcheckbox", {
      name: "Activity Bar",
    });
    await expect(activityBarItem).toBeInTheDocument();
    await expect(activityBarItem).toHaveAttribute("aria-disabled", "true");

    await userEvent.click(statusBarItem);
    await expect(statusBarItem).not.toBeChecked();

    await userEvent.click(triggerButton);
    const reopenedDropdown = screen.getByRole("menu");
    const reopenedPanelItem = within(reopenedDropdown).getByRole(
      "menuitemcheckbox",
      { name: "Panel" },
    );
    await userEvent.click(reopenedPanelItem);
    await expect(reopenedPanelItem).toBeChecked();
  },
};

/**
 * Checkboxes work the same with a leading icon per item; the play function
 * verifies a toggle round-trip, same as the icon-less Checkboxes story.
 *
 * Verbatim from [shadcn Dropdown Menu › Checkboxes Icons](https://ui.shadcn.com/docs/components/radix/dropdown-menu#checkboxes-icons).
 *
 * @summary for icon-decorated toggle items
 */
export const CheckboxesIcons: Story = {
  tags: ["shadcn-example", "ai-generated"],
  render: function CheckboxesIconsRender() {
    const [notifications, setNotifications] = React.useState({
      email: true,
      sms: false,
      push: true,
    });

    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline">Notifications</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-48">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Notification Preferences</DropdownMenuLabel>
            <DropdownMenuCheckboxItem
              checked={notifications.email}
              onCheckedChange={(checked) =>
                setNotifications({
                  ...notifications,
                  email: checked === true,
                })
              }
            >
              <MailIcon />
              Email notifications
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={notifications.sms}
              onCheckedChange={(checked) =>
                setNotifications({ ...notifications, sms: checked === true })
              }
            >
              <MessageSquareIcon />
              SMS notifications
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={notifications.push}
              onCheckedChange={(checked) =>
                setNotifications({ ...notifications, push: checked === true })
              }
            >
              <BellIcon />
              Push notifications
            </DropdownMenuCheckboxItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  },
  play: async ({ canvas, userEvent }) => {
    const triggerButton = canvas.getByText("Notifications");
    await userEvent.click(triggerButton);

    const dropdown = screen.getByRole("menu");
    const emailItem = within(dropdown).getByRole("menuitemcheckbox", {
      name: /email notifications/i,
    });
    await expect(emailItem).toBeChecked();

    await userEvent.click(emailItem);
    await expect(emailItem).not.toBeChecked();
  },
};

/**
 * Use DropdownMenuRadioGroup for a mutually-exclusive choice; the play
 * function verifies selecting one option clears the others. The composition
 * is verbatim upstream, but our selection indicator is a trailing CheckIcon
 * (an intentional fork — see `DropdownMenuRadioItem` in dropdown-menu.tsx),
 * not the leading dot upstream's own screenshot shows.
 *
 * Verbatim from [shadcn Dropdown Menu › Radio Group](https://ui.shadcn.com/docs/components/radix/dropdown-menu#radio-group).
 *
 * @summary for mutually-exclusive selection
 */
export const RadioGroup: Story = {
  tags: ["shadcn-example", "ai-generated"],
  render: function RadioGroupRender() {
    const [position, setPosition] = React.useState("bottom");

    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline">Open</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-32">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Panel Position</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              onValueChange={setPosition}
              value={position}
            >
              <DropdownMenuRadioItem value="top">Top</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="bottom">
                Bottom
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="right">Right</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  },
  play: async ({ canvas, userEvent }) => {
    const triggerButton = canvas.getByText("Open");
    await userEvent.click(triggerButton);

    const dropdown = screen.getByRole("menu");
    const topItem = within(dropdown).getByRole("menuitemradio", {
      name: "Top",
    });
    const bottomItem = within(dropdown).getByRole("menuitemradio", {
      name: "Bottom",
    });
    const rightItem = within(dropdown).getByRole("menuitemradio", {
      name: "Right",
    });

    await userEvent.click(topItem);
    await expect(topItem).toBeChecked();
    await expect(bottomItem).not.toBeChecked();
    await expect(rightItem).not.toBeChecked();

    await userEvent.click(triggerButton);
    const reopenedDropdown = screen.getByRole("menu");
    const reopenedTopItem = within(reopenedDropdown).getByRole(
      "menuitemradio",
      {
        name: "Top",
      },
    );
    const reopenedBottomItem = within(reopenedDropdown).getByRole(
      "menuitemradio",
      { name: "Bottom" },
    );
    const reopenedRightItem = within(reopenedDropdown).getByRole(
      "menuitemradio",
      {
        name: "Right",
      },
    );
    await userEvent.click(reopenedRightItem);
    await expect(reopenedRightItem).toBeChecked();
    await expect(reopenedTopItem).not.toBeChecked();
    await expect(reopenedBottomItem).not.toBeChecked();
  },
};

/**
 * Radio items work the same with a leading icon per option; the play
 * function verifies the default selection and a round-trip, same idea as
 * the icon-less RadioGroup story.
 *
 * Verbatim from [shadcn Dropdown Menu › Radio Icons](https://ui.shadcn.com/docs/components/radix/dropdown-menu#radio-icons).
 *
 * @summary for icon-decorated mutually-exclusive selection
 */
export const RadioIcons: Story = {
  tags: ["shadcn-example", "ai-generated"],
  render: function RadioIconsRender() {
    const [paymentMethod, setPaymentMethod] = React.useState("card");

    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline">Payment Method</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="min-w-56">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Select Payment Method</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={paymentMethod}
              onValueChange={setPaymentMethod}
            >
              <DropdownMenuRadioItem value="card">
                <CreditCardIcon />
                Credit Card
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="paypal">
                <WalletIcon />
                PayPal
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="bank">
                <Building2Icon />
                Bank Transfer
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  },
  play: async ({ canvas, userEvent }) => {
    const triggerButton = canvas.getByText("Payment Method");
    await userEvent.click(triggerButton);

    const dropdown = screen.getByRole("menu");
    const cardItem = within(dropdown).getByRole("menuitemradio", {
      name: /credit card/i,
    });
    const paypalItem = within(dropdown).getByRole("menuitemradio", {
      name: /paypal/i,
    });
    await expect(cardItem).toBeChecked();

    await userEvent.click(paypalItem);
    await expect(paypalItem).toBeChecked();
    await expect(cardItem).not.toBeChecked();
  },
};

/**
 * Use `variant="destructive"` on a DropdownMenuItem for an irreversible or
 * dangerous action, such as deleting a resource; the play function verifies
 * the item carries the destructive styling hook.
 *
 * Verbatim from [shadcn Dropdown Menu › Destructive](https://ui.shadcn.com/docs/components/radix/dropdown-menu#destructive).
 *
 * @summary for a dangerous or irreversible action within a menu
 */
export const Destructive: Story = {
  tags: ["shadcn-example", "ai-generated"],
  args: {},
  render: (args) => (
    <DropdownMenu {...args}>
      <DropdownMenuTrigger asChild>
        <Button variant="outline">Actions</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuGroup>
          <DropdownMenuItem>
            <PencilIcon />
            Edit
          </DropdownMenuItem>
          <DropdownMenuItem>
            <ShareIcon />
            Share
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem variant="destructive">
            <TrashIcon />
            Delete
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  ),
  play: async ({ canvas, userEvent }) => {
    const triggerButton = canvas.getByText("Actions");
    await userEvent.click(triggerButton);

    const dropdown = screen.getByRole("menu");
    const deleteItem = within(dropdown).getByRole("menuitem", {
      name: /delete/i,
    });
    await expect(deleteItem).toBeInTheDocument();
    await expect(deleteItem).toHaveAttribute("data-variant", "destructive");
  },
};

/**
 * Use an Avatar as the dropdown trigger for an account menu; the play
 * function verifies the menu opens with its items. Named `AvatarMenu`
 * rather than `Avatar` to avoid colliding with the imported `Avatar`
 * component identifier — a different upstream example, with different menu
 * contents, from Avatar's own "Dropdown" story in avatar.stories.tsx.
 *
 * Verbatim from [shadcn Dropdown Menu › Avatar](https://ui.shadcn.com/docs/components/radix/dropdown-menu#avatar).
 *
 * @summary for an avatar-triggered account menu
 */
export const AvatarMenu: Story = {
  tags: ["shadcn-example", "ai-generated"],
  args: {},
  render: (args) => (
    <DropdownMenu {...args}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="rounded-full">
          <Avatar>
            <AvatarImage src="https://github.com/shadcn.png" alt="shadcn" />
            <AvatarFallback>LR</AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuGroup>
          <DropdownMenuItem>
            <BadgeCheckIcon />
            Account
          </DropdownMenuItem>
          <DropdownMenuItem>
            <CreditCardIcon />
            Billing
          </DropdownMenuItem>
          <DropdownMenuItem>
            <BellIcon />
            Notifications
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem>
          <LogOutIcon />
          Sign Out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  ),
  play: async ({ canvas, userEvent }) => {
    const trigger = canvas.getByRole("button");
    await userEvent.click(trigger);

    const menu = await screen.findByRole("menu");
    await expect(within(menu).getByText("Account")).toBeInTheDocument();
    await expect(within(menu).getByText("Sign Out")).toBeInTheDocument();
  },
};

/**
 * A large, real-world composition: nested submenus several levels deep,
 * checkboxes and a radio group inside submenus, and grouped sections. The
 * play function spot-checks two independent submenu branches rather than
 * the whole tree.
 *
 * Verbatim from [shadcn Dropdown Menu › Complex](https://ui.shadcn.com/docs/components/radix/dropdown-menu#complex).
 *
 * @summary for a large real-world menu composition
 */
export const Complex: Story = {
  tags: ["shadcn-example", "ai-generated"],
  render: function ComplexRender() {
    const [notifications, setNotifications] = React.useState({
      email: true,
      sms: false,
      push: true,
    });
    const [theme, setTheme] = React.useState("light");

    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline">Complex Menu</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-44">
          <DropdownMenuGroup>
            <DropdownMenuLabel>File</DropdownMenuLabel>
            <DropdownMenuItem>
              <FileIcon />
              New File
              <DropdownMenuShortcut>⌘N</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem>
              <FolderIcon />
              New Folder
              <DropdownMenuShortcut>⇧⌘N</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <FolderOpenIcon />
                Open Recent
              </DropdownMenuSubTrigger>
              <DropdownMenuPortal>
                <DropdownMenuSubContent>
                  <DropdownMenuGroup>
                    <DropdownMenuLabel>Recent Projects</DropdownMenuLabel>
                    <DropdownMenuItem>
                      <FileCodeIcon />
                      Project Alpha
                    </DropdownMenuItem>
                    <DropdownMenuItem>
                      <FileCodeIcon />
                      Project Beta
                    </DropdownMenuItem>
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger>
                        <MoreHorizontalIcon />
                        More Projects
                      </DropdownMenuSubTrigger>
                      <DropdownMenuPortal>
                        <DropdownMenuSubContent>
                          <DropdownMenuItem>
                            <FileCodeIcon />
                            Project Gamma
                          </DropdownMenuItem>
                          <DropdownMenuItem>
                            <FileCodeIcon />
                            Project Delta
                          </DropdownMenuItem>
                        </DropdownMenuSubContent>
                      </DropdownMenuPortal>
                    </DropdownMenuSub>
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuGroup>
                    <DropdownMenuItem>
                      <FolderSearchIcon />
                      Browse...
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                </DropdownMenuSubContent>
              </DropdownMenuPortal>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
            <DropdownMenuItem>
              <SaveIcon />
              Save
              <DropdownMenuShortcut>⌘S</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem>
              <DownloadIcon />
              Export
              <DropdownMenuShortcut>⇧⌘E</DropdownMenuShortcut>
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuLabel>View</DropdownMenuLabel>
            <DropdownMenuCheckboxItem
              checked={notifications.email}
              onCheckedChange={(checked) =>
                setNotifications({
                  ...notifications,
                  email: checked === true,
                })
              }
            >
              <EyeIcon />
              Show Sidebar
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={notifications.sms}
              onCheckedChange={(checked) =>
                setNotifications({ ...notifications, sms: checked === true })
              }
            >
              <LayoutIcon />
              Show Status Bar
            </DropdownMenuCheckboxItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <PaletteIcon />
                Theme
              </DropdownMenuSubTrigger>
              <DropdownMenuPortal>
                <DropdownMenuSubContent>
                  <DropdownMenuGroup>
                    <DropdownMenuLabel>Appearance</DropdownMenuLabel>
                    <DropdownMenuRadioGroup
                      value={theme}
                      onValueChange={setTheme}
                    >
                      <DropdownMenuRadioItem value="light">
                        <SunIcon />
                        Light
                      </DropdownMenuRadioItem>
                      <DropdownMenuRadioItem value="dark">
                        <MoonIcon />
                        Dark
                      </DropdownMenuRadioItem>
                      <DropdownMenuRadioItem value="system">
                        <MonitorIcon />
                        System
                      </DropdownMenuRadioItem>
                    </DropdownMenuRadioGroup>
                  </DropdownMenuGroup>
                </DropdownMenuSubContent>
              </DropdownMenuPortal>
            </DropdownMenuSub>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuLabel>Account</DropdownMenuLabel>
            <DropdownMenuItem>
              <UserIcon />
              Profile
              <DropdownMenuShortcut>⇧⌘P</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem>
              <CreditCardIcon />
              Billing
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <SettingsIcon />
                Settings
              </DropdownMenuSubTrigger>
              <DropdownMenuPortal>
                <DropdownMenuSubContent>
                  <DropdownMenuGroup>
                    <DropdownMenuLabel>Preferences</DropdownMenuLabel>
                    <DropdownMenuItem>
                      <KeyboardIcon />
                      Keyboard Shortcuts
                    </DropdownMenuItem>
                    <DropdownMenuItem>
                      <LanguagesIcon />
                      Language
                    </DropdownMenuItem>
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger>
                        <BellIcon />
                        Notifications
                      </DropdownMenuSubTrigger>
                      <DropdownMenuPortal>
                        <DropdownMenuSubContent>
                          <DropdownMenuGroup>
                            <DropdownMenuLabel>
                              Notification Types
                            </DropdownMenuLabel>
                            <DropdownMenuCheckboxItem
                              checked={notifications.push}
                              onCheckedChange={(checked) =>
                                setNotifications({
                                  ...notifications,
                                  push: checked === true,
                                })
                              }
                            >
                              <BellIcon />
                              Push Notifications
                            </DropdownMenuCheckboxItem>
                            <DropdownMenuCheckboxItem
                              checked={notifications.email}
                              onCheckedChange={(checked) =>
                                setNotifications({
                                  ...notifications,
                                  email: checked === true,
                                })
                              }
                            >
                              <MailIcon />
                              Email Notifications
                            </DropdownMenuCheckboxItem>
                          </DropdownMenuGroup>
                        </DropdownMenuSubContent>
                      </DropdownMenuPortal>
                    </DropdownMenuSub>
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuGroup>
                    <DropdownMenuItem>
                      <ShieldIcon />
                      Privacy & Security
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                </DropdownMenuSubContent>
              </DropdownMenuPortal>
            </DropdownMenuSub>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem>
              <HelpCircleIcon />
              Help & Support
            </DropdownMenuItem>
            <DropdownMenuItem>
              <FileTextIcon />
              Documentation
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem variant="destructive">
              <LogOutIcon />
              Sign Out
              <DropdownMenuShortcut>⇧⌘Q</DropdownMenuShortcut>
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  },
  play: async ({ canvas, userEvent }) => {
    const triggerButton = canvas.getByText("Complex Menu");
    await userEvent.click(triggerButton);

    const dropdown = screen.getByRole("menu");
    await expect(dropdown).toBeInTheDocument();

    const openRecentItem = within(dropdown).getByText("Open Recent");
    await userEvent.click(openRecentItem);

    const projectAlpha = await screen.findByText("Project Alpha");
    await expect(projectAlpha).toBeInTheDocument();
    await waitFor(() => expect(projectAlpha).toBeVisible());

    const themeItem = screen.getByText("Theme");
    await userEvent.click(themeItem);

    const lightOption = await screen.findByRole("menuitemradio", {
      name: /light/i,
    });
    await waitFor(() => expect(lightOption).toBeVisible());
    await expect(lightOption).toBeChecked();
  },
};
