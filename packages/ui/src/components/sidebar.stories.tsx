import * as React from "react";
import {
  AudioWaveform,
  BadgeCheck,
  Bell,
  BookOpen,
  Bot,
  ChevronDownIcon,
  ChevronRight,
  ChevronRightIcon,
  ChevronsUpDown,
  ChevronUpIcon,
  Command,
  CreditCard,
  Folder,
  Forward,
  Frame,
  FrameIcon,
  GalleryVerticalEnd,
  LifeBuoyIcon,
  LogOut,
  Map,
  MapIcon,
  MoreHorizontal,
  MoreHorizontalIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  PieChart,
  PieChartIcon,
  Plus,
  PlusIcon,
  SendIcon,
  Settings2,
  Sparkles,
  SquareTerminal,
  Trash2,
} from "lucide-react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { toast } from "sonner";
import { expect, screen, waitFor, within } from "storybook/test";

import { Avatar, AvatarFallback, AvatarImage } from "./avatar.js";
import { Button } from "./button.js";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "./collapsible.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "./dropdown-menu.js";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "./sidebar.js";
import { Toaster } from "./sonner.js";

// Every story in this file is transcribed from the shadcn Sidebar docs
// examples (https://ui.shadcn.com/docs/components/radix/sidebar), so the
// file carries the "shadcn-example" provenance tag at the meta level. Source
// is `apps/v4/examples/radix/sidebar-<x>.tsx` on GitHub main — the files the
// docs' "Radix UI" tab renders. Sidebar composes Collapsible, DropdownMenu,
// Tooltip, Input, Separator, Sheet, Skeleton, and Button; all are vendored
// here (`ls packages/ui/src/components/*.tsx` confirmed), so no example was
// skipped for a missing companion.
//
// Of the 14 upstream examples, 12 are covered below and 2 are skipped:
// - `sidebar-rtl` — RTL/`dir="rtl"` demo, skipped by convention.
// - `sidebar-rsc` — its `NavProjects` is an `async function` component
//   awaiting a fake fetch, rendered via `<React.Suspense>` around a plain
//   JSX element (`<NavProjects />`). That pattern only resolves when a
//   framework's RSC runtime is doing the awaiting server-side; a purely
//   client-rendered Vite/Storybook tree has no mechanism to await an async
//   component returning a Promise-of-JSX, so this cannot be adapted into a
//   client story without rewriting the fetch as client `useEffect` state —
//   which would no longer be transcribing the example, so it's skipped
//   rather than faked. `SidebarMenuSkeleton` (used only in this example's
//   fallback) has no other coverage in this file as a result.
//
// Unlike other components' docs pages, the Sidebar page renders only ONE
// live `<ComponentPreview>` — the unanchored `sidebar-demo` hero at the top,
// which backs `Basic` below (no anchor, same precedent as `avatar-demo` in
// avatar.stories.tsx). Every other source file is a standalone runnable demo
// app whose *concept* is discussed in a `##` section of prose but is not
// itself rendered as a live, individually anchored example. Each story below
// links the closest matching section anchor; `GroupAction`/`GroupCollapsible`
// share `#sidebargroup` with `Group` (all three are usages of that one
// section), and `MenuCollapsible` links `#sidebarmenu` (the closest section —
// there is no dedicated "collapsible menu" heading; the pattern is otherwise
// only shown combined with a dozen other concerns in the `Basic` hero).
//
// Adaptations beyond import paths (icons are already `lucide-react` upstream,
// no substitution needed; primitives are already plain `<a>`, no `next/link`
// to swap):
// - `sidebar-group-action.tsx` imports `Toaster` directly from the `sonner`
//   package; we use our vendored `./sonner.js` `Toaster` instead (it wires
//   `next-themes` and our token colors), matching the established precedent
//   in sonner.stories.tsx. `toast` itself is still imported from the `sonner`
//   package directly, matching upstream and that same precedent.
// - `sidebar-menu-collapsible.tsx` wraps each `<SidebarMenuItem>` (an `<li>`)
//   in a `<Collapsible>` *without* `asChild`, so Radix's default `<div>`
//   root lands as a direct, non-`<li>` child of `SidebarMenu`'s `<ul>` — a
//   real `list`/`listitem` axe violation under our stricter a11y gate, not a
//   false positive (caught by `test:storybook`). `sidebar-demo.tsx`'s own
//   `NavMain` already does this correctly (`<Collapsible asChild>`), so we
//   add the same `asChild` here to match it, the minimal a11y-gate fix.
//
// Framing: this is a full-height layout, not an inline control, so it does
// NOT follow the "centered + fixed-width decorator" convention used for
// inline components (accordion, select, ...). Sidebar's desktop container is
// `position: fixed; inset-y-0; height: 100svh` (sidebar.tsx's `Sidebar`) —
// sized and positioned relative to the *browsing context's own viewport*,
// not any ancestor element. A plain wrapper `<div className="h-[32rem]">`
// would be silently ignored by that fixed positioning (the sidebar would
// still try to span the full host document), so it can't provide real
// containment. Storybook's `docs.story.inline: false` is the actual fix: it
// renders each Autodocs example inside its own dedicated iframe (given
// `iframeHeight`), which the fixed-positioned sidebar now sizes itself
// against correctly, mirroring how the regular Canvas story view already
// renders every story inside Storybook's own preview iframe.
// `layout: "fullscreen"` removes the default padding/centering chrome so the
// layout fills that space edge-to-edge like a real page, instead of floating
// in a padded box.
//
// `aria-hidden-focus` is disabled at the meta level for the same reason
// dropdown-menu.stories.tsx disables it: Radix portals `DropdownMenuContent`
// outside the trigger's DOM subtree and toggles `aria-hidden` on the rest of
// the page while open, which axe's `aria-hidden-focus` rule misreads as a
// focusable trigger trapped inside an `aria-hidden` container — a false
// positive of the portal + test-environment combination, not a real browser
// issue. Several stories below (`Basic`, `Header`, `Footer`, `MenuAction`)
// open a `DropdownMenu`, so the same false positive applies here.
const meta = {
  component: Sidebar,
  subcomponents: {
    SidebarContent,
    SidebarFooter,
    SidebarGroup,
    SidebarGroupAction,
    SidebarGroupContent,
    SidebarGroupLabel,
    SidebarHeader,
    SidebarInset,
    SidebarMenu,
    SidebarMenuAction,
    SidebarMenuBadge,
    SidebarMenuButton,
    SidebarMenuItem,
    SidebarMenuSub,
    SidebarMenuSubButton,
    SidebarMenuSubItem,
    SidebarProvider,
    SidebarTrigger,
  },
  parameters: {
    layout: "fullscreen",
    docs: {
      story: {
        inline: false,
        iframeHeight: "32rem",
      },
    },
    a11y: {
      config: {
        rules: [{ id: "aria-hidden-focus", enabled: false }],
      },
    },
  },
  tags: ["autodocs", "shadcn-example", "ai-generated"],
} satisfies Meta<typeof Sidebar>;

export default meta;

type Story = StoryObj<typeof meta>;

// ---------------------------------------------------------------------------
// Basic ← sidebar-demo
// ---------------------------------------------------------------------------

const demoData = {
  user: {
    name: "shadcn",
    email: "m@example.com",
    avatar: "/avatars/shadcn.jpg",
  },
  teams: [
    { name: "Acme Inc", logo: GalleryVerticalEnd, plan: "Enterprise" },
    { name: "Acme Corp.", logo: AudioWaveform, plan: "Startup" },
    { name: "Evil Corp.", logo: Command, plan: "Free" },
  ],
  navMain: [
    {
      title: "Playground",
      url: "#",
      icon: SquareTerminal,
      isActive: true,
      items: [
        { title: "History", url: "#" },
        { title: "Starred", url: "#" },
        { title: "Settings", url: "#" },
      ],
    },
    {
      title: "Models",
      url: "#",
      icon: Bot,
      items: [
        { title: "Genesis", url: "#" },
        { title: "Explorer", url: "#" },
        { title: "Quantum", url: "#" },
      ],
    },
    {
      title: "Documentation",
      url: "#",
      icon: BookOpen,
      items: [
        { title: "Introduction", url: "#" },
        { title: "Get Started", url: "#" },
        { title: "Tutorials", url: "#" },
        { title: "Changelog", url: "#" },
      ],
    },
    {
      title: "Settings",
      url: "#",
      icon: Settings2,
      items: [
        { title: "General", url: "#" },
        { title: "Team", url: "#" },
        { title: "Billing", url: "#" },
        { title: "Limits", url: "#" },
      ],
    },
  ],
  projects: [
    { name: "Design Engineering", url: "#", icon: Frame },
    { name: "Sales & Marketing", url: "#", icon: PieChart },
    { name: "Travel", url: "#", icon: Map },
  ],
};

function DemoTeamSwitcher({
  teams,
}: {
  teams: { name: string; logo: React.ElementType; plan: string }[];
}) {
  const { isMobile } = useSidebar();
  const [activeTeam, setActiveTeam] = React.useState(teams[0]);

  if (!activeTeam) {
    return null;
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                <activeTeam.logo className="size-4" />
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">{activeTeam.name}</span>
                <span className="truncate text-xs">{activeTeam.plan}</span>
              </div>
              <ChevronsUpDown className="ml-auto" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
            align="start"
            side={isMobile ? "bottom" : "right"}
            sideOffset={4}
          >
            <DropdownMenuGroup>
              <DropdownMenuLabel className="text-xs text-muted-foreground">
                Teams
              </DropdownMenuLabel>
              {teams.map((team, index) => (
                <DropdownMenuItem
                  key={team.name}
                  onClick={() => setActiveTeam(team)}
                  className="gap-2 p-2"
                >
                  <div className="flex size-6 items-center justify-center rounded-md border">
                    <team.logo className="size-3.5 shrink-0" />
                  </div>
                  {team.name}
                  <DropdownMenuShortcut>⌘{index + 1}</DropdownMenuShortcut>
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem className="gap-2 p-2">
                <div className="flex size-6 items-center justify-center rounded-md border bg-transparent">
                  <Plus className="size-4" />
                </div>
                <div className="font-medium text-muted-foreground">
                  Add team
                </div>
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

function DemoNavMain({
  items,
}: {
  items: {
    title: string;
    url: string;
    icon?: React.ElementType;
    isActive?: boolean;
    items?: { title: string; url: string }[];
  }[];
}) {
  return (
    <SidebarGroup>
      <SidebarGroupLabel>Platform</SidebarGroupLabel>
      <SidebarMenu>
        {items.map((item) => (
          <Collapsible
            key={item.title}
            asChild
            defaultOpen={item.isActive}
            className="group/collapsible"
          >
            <SidebarMenuItem>
              <CollapsibleTrigger asChild>
                <SidebarMenuButton tooltip={item.title}>
                  {item.icon && <item.icon />}
                  <span>{item.title}</span>
                  <ChevronRight className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                </SidebarMenuButton>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <SidebarMenuSub>
                  {item.items?.map((subItem) => (
                    <SidebarMenuSubItem key={subItem.title}>
                      <SidebarMenuSubButton asChild>
                        <a href={subItem.url}>
                          <span>{subItem.title}</span>
                        </a>
                      </SidebarMenuSubButton>
                    </SidebarMenuSubItem>
                  ))}
                </SidebarMenuSub>
              </CollapsibleContent>
            </SidebarMenuItem>
          </Collapsible>
        ))}
      </SidebarMenu>
    </SidebarGroup>
  );
}

function DemoNavProjects({
  projects,
}: {
  projects: { name: string; url: string; icon: React.ElementType }[];
}) {
  const { isMobile } = useSidebar();

  return (
    <SidebarGroup className="group-data-[collapsible=icon]:hidden">
      <SidebarGroupLabel>Projects</SidebarGroupLabel>
      <SidebarMenu>
        {projects.map((item) => (
          <SidebarMenuItem key={item.name}>
            <SidebarMenuButton asChild>
              <a href={item.url}>
                <item.icon />
                <span>{item.name}</span>
              </a>
            </SidebarMenuButton>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuAction showOnHover>
                  <MoreHorizontal />
                  <span className="sr-only">More</span>
                </SidebarMenuAction>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                className="w-48 rounded-lg"
                side={isMobile ? "bottom" : "right"}
                align={isMobile ? "end" : "start"}
              >
                <DropdownMenuGroup>
                  <DropdownMenuItem>
                    <Folder className="text-muted-foreground" />
                    <span>View Project</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem>
                    <Forward className="text-muted-foreground" />
                    <span>Share Project</span>
                  </DropdownMenuItem>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuItem>
                    <Trash2 className="text-muted-foreground" />
                    <span>Delete Project</span>
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        ))}
        <SidebarMenuItem>
          <SidebarMenuButton className="text-sidebar-foreground/70">
            <MoreHorizontal className="text-sidebar-foreground/70" />
            <span>More</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarGroup>
  );
}

function DemoNavUser({
  user,
}: {
  user: { name: string; email: string; avatar: string };
}) {
  const { isMobile } = useSidebar();

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <Avatar className="h-8 w-8 rounded-lg">
                <AvatarImage src={user.avatar} alt={user.name} />
                <AvatarFallback className="rounded-lg">CN</AvatarFallback>
              </Avatar>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">{user.name}</span>
                <span className="truncate text-xs">{user.email}</span>
              </div>
              <ChevronsUpDown className="ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
            side={isMobile ? "bottom" : "right"}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuGroup>
              <DropdownMenuLabel className="p-0 font-normal">
                <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                  <Avatar className="h-8 w-8 rounded-lg">
                    <AvatarImage src={user.avatar} alt={user.name} />
                    <AvatarFallback className="rounded-lg">CN</AvatarFallback>
                  </Avatar>
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-medium">{user.name}</span>
                    <span className="truncate text-xs">{user.email}</span>
                  </div>
                </div>
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem>
                <Sparkles />
                Upgrade to Pro
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem>
                <BadgeCheck />
                Account
              </DropdownMenuItem>
              <DropdownMenuItem>
                <CreditCard />
                Billing
              </DropdownMenuItem>
              <DropdownMenuItem>
                <Bell />
                Notifications
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem>
                <LogOut />
                Log out
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

function SidebarDemoApp() {
  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <DemoTeamSwitcher teams={demoData.teams} />
        </SidebarHeader>
        <SidebarContent>
          <DemoNavMain items={demoData.navMain} />
          <DemoNavProjects projects={demoData.projects} />
        </SidebarContent>
        <SidebarFooter>
          <DemoNavUser user={demoData.user} />
        </SidebarFooter>
      </Sidebar>
      <SidebarInset>
        <header className="flex h-16 shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
          <div className="flex items-center gap-2 px-4">
            <SidebarTrigger className="-ml-1" />
          </div>
        </header>
      </SidebarInset>
    </SidebarProvider>
  );
}

/**
 * Use the full composition — a workspace switcher, collapsible nested
 * navigation, a projects list with a per-item action menu, and a user
 * account menu — as the reference for wiring a real application sidebar;
 * the play function verifies the default-open nav section, expanding a
 * sibling section, and that the trigger's toggle persists via cookie.
 *
 * Adapted from [shadcn Sidebar](https://ui.shadcn.com/docs/components/radix/sidebar)
 * (the default example at the top of the page, before any heading).
 *
 * @summary for the full application-sidebar composition
 */
export const Basic: Story = {
  render: () => <SidebarDemoApp />,
  play: async ({ canvas, userEvent }) => {
    // "Playground" is `isActive`, so its Collapsible defaults open.
    await expect(canvas.getByText("History")).toBeVisible();
    await expect(canvas.queryByText("Genesis")).not.toBeInTheDocument();

    await userEvent.click(canvas.getByRole("button", { name: "Models" }));
    await waitFor(() => expect(canvas.getByText("Genesis")).toBeVisible());

    document.cookie = "sidebar_state=; path=/; max-age=0";
    await userEvent.click(
      canvas.getByRole("button", { name: "Toggle Sidebar" }),
    );
    await waitFor(() =>
      expect(document.cookie).toContain("sidebar_state=false"),
    );
  },
};

// ---------------------------------------------------------------------------
// Controlled ← sidebar-controlled
// ---------------------------------------------------------------------------

const controlledProjects = [
  { name: "Design Engineering", url: "#", icon: FrameIcon },
  { name: "Sales & Marketing", url: "#", icon: PieChartIcon },
  { name: "Travel", url: "#", icon: MapIcon },
  { name: "Support", url: "#", icon: LifeBuoyIcon },
  { name: "Feedback", url: "#", icon: SendIcon },
];

function SidebarControlledApp() {
  const [open, setOpen] = React.useState(true);

  return (
    <SidebarProvider open={open} onOpenChange={setOpen}>
      <Sidebar>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Projects</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {controlledProjects.map((project) => (
                  <SidebarMenuItem key={project.name}>
                    <SidebarMenuButton asChild>
                      <a href={project.url}>
                        <project.icon />
                        <span>{project.name}</span>
                      </a>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>
      <SidebarInset>
        <header className="flex h-12 items-center justify-between px-4">
          <Button onClick={() => setOpen((o) => !o)} size="sm" variant="ghost">
            {open ? <PanelLeftCloseIcon /> : <PanelLeftOpenIcon />}
            <span>{open ? "Close" : "Open"} Sidebar</span>
          </Button>
        </header>
      </SidebarInset>
    </SidebarProvider>
  );
}

/**
 * Use the `open`/`onOpenChange` pair on `SidebarProvider` to drive the
 * sidebar from state you own, instead of its internal
 * cookie-backed state; the play function verifies the external button
 * toggles both the sidebar and its own label.
 *
 * Adapted from [shadcn Sidebar › Controlled Sidebar](https://ui.shadcn.com/docs/components/radix/sidebar#controlled-sidebar).
 *
 * @summary for a sidebar driven by externally-owned open state
 */
export const Controlled: Story = {
  render: () => <SidebarControlledApp />,
  play: async ({ canvas, userEvent }) => {
    const toggle = canvas.getByRole("button", { name: "Close Sidebar" });
    await expect(toggle).toBeInTheDocument();

    await userEvent.click(toggle);
    await expect(
      canvas.getByRole("button", { name: "Open Sidebar" }),
    ).toBeInTheDocument();

    await userEvent.click(canvas.getByRole("button", { name: "Open Sidebar" }));
    await expect(
      canvas.getByRole("button", { name: "Close Sidebar" }),
    ).toBeInTheDocument();
  },
};

// ---------------------------------------------------------------------------
// Header ← sidebar-header
// ---------------------------------------------------------------------------

function SidebarHeaderApp() {
  return (
    <SidebarProvider>
      <Sidebar>
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <SidebarMenuButton className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground">
                    Select Workspace
                    <ChevronDownIcon className="ml-auto" />
                  </SidebarMenuButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-(--radix-popper-anchor-width)">
                  <DropdownMenuItem>
                    <span>Acme Inc</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem>
                    <span>Acme Corp.</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>
      </Sidebar>
      <SidebarInset>
        <header className="flex h-12 items-center justify-between px-4">
          <SidebarTrigger />
        </header>
      </SidebarInset>
    </SidebarProvider>
  );
}

/**
 * Use `SidebarHeader` to pin a sticky region above the scrollable content —
 * here, a workspace switcher; the play function verifies the dropdown opens
 * with both workspaces listed.
 *
 * Adapted from [shadcn Sidebar › SidebarHeader](https://ui.shadcn.com/docs/components/radix/sidebar#sidebarheader).
 *
 * @summary for a sticky header, e.g. a workspace switcher
 */
export const Header: Story = {
  render: () => <SidebarHeaderApp />,
  play: async ({ canvas, userEvent }) => {
    const trigger = canvas.getByRole("button", { name: /Select Workspace/ });
    await userEvent.click(trigger);

    const menu = await screen.findByRole("menu");
    await expect(within(menu).getByText("Acme Inc")).toBeInTheDocument();
    await expect(within(menu).getByText("Acme Corp.")).toBeInTheDocument();
  },
};

// ---------------------------------------------------------------------------
// Footer ← sidebar-footer
// ---------------------------------------------------------------------------

function SidebarFooterApp() {
  return (
    <SidebarProvider>
      <Sidebar>
        <SidebarHeader />
        <SidebarContent />
        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <SidebarMenuButton className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground">
                    Username
                    <ChevronUpIcon className="ml-auto" />
                  </SidebarMenuButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  side="top"
                  className="w-(--radix-popper-anchor-width)"
                >
                  <DropdownMenuItem>
                    <span>Account</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem>
                    <span>Billing</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem>
                    <span>Sign out</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset>
        <header className="flex h-12 items-center justify-between px-4">
          <SidebarTrigger />
        </header>
      </SidebarInset>
    </SidebarProvider>
  );
}

/**
 * Use `SidebarFooter` to pin a sticky region below the scrollable content —
 * here, a user account menu; the play function verifies the dropdown opens
 * with its actions listed.
 *
 * Adapted from [shadcn Sidebar › SidebarFooter](https://ui.shadcn.com/docs/components/radix/sidebar#sidebarfooter).
 *
 * @summary for a sticky footer, e.g. a user account menu
 */
export const Footer: Story = {
  render: () => <SidebarFooterApp />,
  play: async ({ canvas, userEvent }) => {
    const trigger = canvas.getByRole("button", { name: /Username/ });
    await userEvent.click(trigger);

    const menu = await screen.findByRole("menu");
    await expect(within(menu).getByText("Account")).toBeInTheDocument();
    await expect(within(menu).getByText("Billing")).toBeInTheDocument();
    await expect(within(menu).getByText("Sign out")).toBeInTheDocument();
  },
};

// ---------------------------------------------------------------------------
// Group ← sidebar-group
// ---------------------------------------------------------------------------

function SidebarGroupApp() {
  return (
    <SidebarProvider>
      <Sidebar>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Help</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton>
                    <LifeBuoyIcon />
                    Support
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton>
                    <SendIcon />
                    Feedback
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>
    </SidebarProvider>
  );
}

/**
 * Use `SidebarGroup` with a `SidebarGroupLabel` and `SidebarGroupContent` to
 * section related navigation — the baseline composition every other group
 * variant below builds on.
 *
 * Adapted from [shadcn Sidebar › SidebarGroup](https://ui.shadcn.com/docs/components/radix/sidebar#sidebargroup).
 *
 * @summary for a labelled section of navigation
 */
export const Group: Story = {
  render: () => <SidebarGroupApp />,
};

// ---------------------------------------------------------------------------
// GroupCollapsible ← sidebar-group-collapsible
// ---------------------------------------------------------------------------

function SidebarGroupCollapsibleApp() {
  return (
    <SidebarProvider>
      <Sidebar>
        <SidebarContent>
          <Collapsible defaultOpen className="group/collapsible">
            <SidebarGroup>
              <SidebarGroupLabel
                asChild
                className="text-sm hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              >
                <CollapsibleTrigger>
                  Help
                  <ChevronDownIcon className="ml-auto transition-transform group-data-[state=open]/collapsible:rotate-180" />
                </CollapsibleTrigger>
              </SidebarGroupLabel>
              <CollapsibleContent>
                <SidebarGroupContent>
                  <SidebarMenu>
                    <SidebarMenuItem>
                      <SidebarMenuButton>
                        <LifeBuoyIcon />
                        Support
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                    <SidebarMenuItem>
                      <SidebarMenuButton>
                        <SendIcon />
                        Feedback
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  </SidebarMenu>
                </SidebarGroupContent>
              </CollapsibleContent>
            </SidebarGroup>
          </Collapsible>
        </SidebarContent>
      </Sidebar>
    </SidebarProvider>
  );
}

/**
 * Wrap a `SidebarGroup` in a `Collapsible`, and make its `SidebarGroupLabel`
 * the trigger via `asChild`, to let the whole section collapse; the play
 * function verifies the group starts open (`defaultOpen`) and toggles
 * closed and back.
 *
 * Adapted from [shadcn Sidebar › SidebarGroup](https://ui.shadcn.com/docs/components/radix/sidebar#sidebargroup)
 * (the collapsible-group snippet within that section).
 *
 * @summary for a section of navigation that can collapse independently
 */
export const GroupCollapsible: Story = {
  render: () => <SidebarGroupCollapsibleApp />,
  play: async ({ canvas, userEvent }) => {
    const trigger = canvas.getByRole("button", { name: /Help/ });
    await expect(trigger).toHaveAttribute("data-state", "open");
    await expect(canvas.getByText("Support")).toBeVisible();

    await userEvent.click(trigger);
    await waitFor(() =>
      expect(trigger).toHaveAttribute("data-state", "closed"),
    );
    await expect(canvas.queryByText("Support")).not.toBeInTheDocument();

    await userEvent.click(trigger);
    await waitFor(() => expect(trigger).toHaveAttribute("data-state", "open"));
    await expect(canvas.getByText("Support")).toBeVisible();
  },
};

// ---------------------------------------------------------------------------
// GroupAction ← sidebar-group-action
// ---------------------------------------------------------------------------

const groupActionProjects = [
  { name: "Design Engineering", url: "#", icon: FrameIcon },
  { name: "Sales & Marketing", url: "#", icon: PieChartIcon },
  { name: "Travel", url: "#", icon: MapIcon },
];

function SidebarGroupActionApp() {
  return (
    <SidebarProvider>
      <Sidebar>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Projects</SidebarGroupLabel>
            <SidebarGroupAction
              title="Add Project"
              onClick={() => toast("You clicked the group action!")}
            >
              <PlusIcon /> <span className="sr-only">Add Project</span>
            </SidebarGroupAction>
            <SidebarGroupContent>
              <SidebarMenu>
                {groupActionProjects.map((project) => (
                  <SidebarMenuItem key={project.name}>
                    <SidebarMenuButton asChild>
                      <a href={project.url}>
                        <project.icon />
                        <span>{project.name}</span>
                      </a>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>
    </SidebarProvider>
  );
}

/**
 * Add a `SidebarGroupAction` beside a `SidebarGroupLabel` for a group-level
 * action, such as adding a new item — it stays outside the collapsible icon
 * rail, unlike `SidebarMenuAction`; the play function verifies the click
 * fires its handler.
 *
 * Adapted from [shadcn Sidebar › SidebarGroup](https://ui.shadcn.com/docs/components/radix/sidebar#sidebargroup)
 * (the group-action snippet within that section).
 *
 * @summary for a group-level action button, e.g. "add item"
 */
export const GroupAction: Story = {
  render: () => <SidebarGroupActionApp />,
  decorators: [
    (StoryFn) => (
      <>
        <StoryFn />
        <Toaster />
      </>
    ),
  ],
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Add Project" }));

    await expect(
      await screen.findByText("You clicked the group action!"),
    ).toBeInTheDocument();
  },
};

// ---------------------------------------------------------------------------
// Menu ← sidebar-menu
// ---------------------------------------------------------------------------

const menuProjects = [
  { name: "Design Engineering", url: "#", icon: FrameIcon },
  { name: "Sales & Marketing", url: "#", icon: PieChartIcon },
  { name: "Travel", url: "#", icon: MapIcon },
  { name: "Support", url: "#", icon: LifeBuoyIcon },
  { name: "Feedback", url: "#", icon: SendIcon },
];

function SidebarMenuApp() {
  return (
    <SidebarProvider>
      <Sidebar>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Projects</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {menuProjects.map((project) => (
                  <SidebarMenuItem key={project.name}>
                    <SidebarMenuButton asChild>
                      <a href={project.url}>
                        <project.icon />
                        <span>{project.name}</span>
                      </a>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>
    </SidebarProvider>
  );
}

/**
 * Use `SidebarMenu` + `SidebarMenuItem` + `SidebarMenuButton` (with
 * `asChild` to render a link) for a flat list of navigation entries — the
 * baseline menu composition every action/badge/sub variant below builds on.
 *
 * Adapted from [shadcn Sidebar › SidebarMenu](https://ui.shadcn.com/docs/components/radix/sidebar#sidebarmenu).
 *
 * @summary for a flat list of navigation links
 */
export const Menu: Story = {
  render: () => <SidebarMenuApp />,
};

// ---------------------------------------------------------------------------
// MenuAction ← sidebar-menu-action
// ---------------------------------------------------------------------------

const menuActionProjects = [
  { name: "Design Engineering", url: "#", icon: FrameIcon },
  { name: "Sales & Marketing", url: "#", icon: PieChartIcon },
  { name: "Travel", url: "#", icon: MapIcon },
  { name: "Support", url: "#", icon: LifeBuoyIcon },
  { name: "Feedback", url: "#", icon: SendIcon },
];

function SidebarMenuActionApp() {
  return (
    <SidebarProvider>
      <Sidebar>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Projects</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {menuActionProjects.map((project) => (
                  <SidebarMenuItem key={project.name}>
                    <SidebarMenuButton
                      asChild
                      className="group-has-[[data-state=open]]/menu-item:bg-sidebar-accent"
                    >
                      <a href={project.url}>
                        <project.icon />
                        <span>{project.name}</span>
                      </a>
                    </SidebarMenuButton>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <SidebarMenuAction>
                          <MoreHorizontalIcon />
                          <span className="sr-only">More</span>
                        </SidebarMenuAction>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent side="right" align="start">
                        <DropdownMenuItem>
                          <span>Edit Project</span>
                        </DropdownMenuItem>
                        <DropdownMenuItem>
                          <span>Delete Project</span>
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>
    </SidebarProvider>
  );
}

/**
 * Add a `SidebarMenuAction` beside a `SidebarMenuButton` for a per-item
 * action menu, positioned independent of the button's own icon/text; the
 * play function verifies its dropdown opens with both actions listed.
 *
 * Adapted from [shadcn Sidebar › SidebarMenuAction](https://ui.shadcn.com/docs/components/radix/sidebar#sidebarmenuaction).
 *
 * @summary for a per-item action menu, e.g. edit/delete
 */
export const MenuAction: Story = {
  render: () => <SidebarMenuActionApp />,
  play: async ({ canvas, userEvent }) => {
    const trigger = canvas.getAllByRole("button", { name: "More" })[0];
    if (!trigger) {
      throw new Error("expected at least one 'More' action button");
    }
    await userEvent.click(trigger);

    const menu = await screen.findByRole("menu");
    await expect(within(menu).getByText("Edit Project")).toBeInTheDocument();
    await expect(within(menu).getByText("Delete Project")).toBeInTheDocument();
  },
};

// ---------------------------------------------------------------------------
// MenuBadge ← sidebar-menu-badge
// ---------------------------------------------------------------------------

const menuBadgeProjects = [
  { name: "Design Engineering", url: "#", icon: FrameIcon, badge: "24" },
  { name: "Sales & Marketing", url: "#", icon: PieChartIcon, badge: "12" },
  { name: "Travel", url: "#", icon: MapIcon, badge: "3" },
  { name: "Support", url: "#", icon: LifeBuoyIcon, badge: "21" },
  { name: "Feedback", url: "#", icon: SendIcon, badge: "8" },
];

function SidebarMenuBadgeApp() {
  return (
    <SidebarProvider>
      <Sidebar>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Projects</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {menuBadgeProjects.map((project) => (
                  <SidebarMenuItem key={project.name}>
                    <SidebarMenuButton
                      asChild
                      className="group-has-[[data-state=open]]/menu-item:bg-sidebar-accent"
                    >
                      <a href={project.url}>
                        <project.icon />
                        <span>{project.name}</span>
                      </a>
                    </SidebarMenuButton>
                    <SidebarMenuBadge>{project.badge}</SidebarMenuBadge>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>
    </SidebarProvider>
  );
}

/**
 * Add a `SidebarMenuBadge` beside a `SidebarMenuButton` for a count or
 * status indicator, such as an unread count — purely presentational, it
 * hides automatically when the sidebar collapses to icon width.
 *
 * Adapted from [shadcn Sidebar › SidebarMenuBadge](https://ui.shadcn.com/docs/components/radix/sidebar#sidebarmenubadge).
 *
 * @summary for a count or status badge on a menu item
 */
export const MenuBadge: Story = {
  render: () => <SidebarMenuBadgeApp />,
};

// ---------------------------------------------------------------------------
// MenuSub ← sidebar-menu-sub
// ---------------------------------------------------------------------------

const menuSubItems = [
  {
    title: "Getting Started",
    url: "#",
    items: [
      { title: "Installation", url: "#" },
      { title: "Project Structure", url: "#" },
    ],
  },
  {
    title: "Build Your Application",
    url: "#",
    items: [
      { title: "Routing", url: "#" },
      { title: "Data Fetching", url: "#" },
      { title: "Rendering", url: "#" },
    ],
  },
];

function SidebarMenuSubApp() {
  return (
    <SidebarProvider>
      <Sidebar>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                {menuSubItems.map((item, index) => (
                  <SidebarMenuItem key={index}>
                    <SidebarMenuButton asChild>
                      <a href={item.url}>
                        <span>{item.title}</span>
                      </a>
                    </SidebarMenuButton>
                    <SidebarMenuSub>
                      {item.items.map((subItem, subIndex) => (
                        <SidebarMenuSubItem key={subIndex}>
                          <SidebarMenuSubButton asChild>
                            <a href={subItem.url}>
                              <span>{subItem.title}</span>
                            </a>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                      ))}
                    </SidebarMenuSub>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>
    </SidebarProvider>
  );
}

/**
 * Nest a `SidebarMenuSub` of `SidebarMenuSubItem`/`SidebarMenuSubButton`
 * under a `SidebarMenuItem` for an always-visible submenu — unlike
 * `MenuCollapsible`, this list has no trigger and is never hidden.
 *
 * Adapted from [shadcn Sidebar › SidebarMenuSub](https://ui.shadcn.com/docs/components/radix/sidebar#sidebarmenusub)
 * (trimmed to two top-level entries; upstream's full example lists four,
 * with dozens of leaf links each — not needed to demonstrate the concept).
 *
 * @summary for an always-visible nested submenu
 */
export const MenuSub: Story = {
  render: () => <SidebarMenuSubApp />,
};

// ---------------------------------------------------------------------------
// MenuCollapsible ← sidebar-menu-collapsible
// ---------------------------------------------------------------------------

const menuCollapsibleItems = [
  {
    title: "Getting Started",
    items: [
      { title: "Installation", url: "#" },
      { title: "Project Structure", url: "#" },
    ],
  },
  {
    title: "Build Your Application",
    items: [
      { title: "Routing", url: "#" },
      { title: "Data Fetching", url: "#" },
      { title: "Rendering", url: "#" },
    ],
  },
];

function SidebarMenuCollapsibleApp() {
  return (
    <SidebarProvider>
      <Sidebar>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                {menuCollapsibleItems.map((item, index) => (
                  <Collapsible
                    key={index}
                    asChild
                    className="group/collapsible"
                    defaultOpen={index === 0}
                  >
                    <SidebarMenuItem>
                      <CollapsibleTrigger asChild>
                        <SidebarMenuButton>
                          <span>{item.title}</span>
                          <ChevronRightIcon className="ml-auto transition-transform group-data-[state=open]/collapsible:rotate-90" />
                        </SidebarMenuButton>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <SidebarMenuSub>
                          {item.items.map((subItem, subIndex) => (
                            <SidebarMenuSubItem key={subIndex}>
                              <SidebarMenuSubButton asChild>
                                <a href={subItem.url}>
                                  <span>{subItem.title}</span>
                                </a>
                              </SidebarMenuSubButton>
                            </SidebarMenuSubItem>
                          ))}
                        </SidebarMenuSub>
                      </CollapsibleContent>
                    </SidebarMenuItem>
                  </Collapsible>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>
    </SidebarProvider>
  );
}

/**
 * Wrap a `SidebarMenuItem` in a `Collapsible`, trigger via the
 * `SidebarMenuButton` itself, to make each submenu independently
 * expandable/collapsible — unlike `MenuSub`, which is always visible; the
 * play function verifies the first section's `defaultOpen` and expanding a
 * sibling section.
 *
 * Adapted from [shadcn Sidebar › SidebarMenu](https://ui.shadcn.com/docs/components/radix/sidebar#sidebarmenu)
 * (no dedicated docs anchor exists for this pattern — see the file-level
 * comment above).
 *
 * @summary for an independently-collapsible nested submenu
 */
export const MenuCollapsible: Story = {
  render: () => <SidebarMenuCollapsibleApp />,
  play: async ({ canvas, userEvent }) => {
    await expect(canvas.getByText("Installation")).toBeVisible();
    await expect(canvas.queryByText("Routing")).not.toBeInTheDocument();

    await userEvent.click(
      canvas.getByRole("button", { name: "Build Your Application" }),
    );
    await waitFor(() => expect(canvas.getByText("Routing")).toBeVisible());
  },
};
