import { AppWindowIcon, CodeIcon } from "lucide-react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, within } from "storybook/test";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./card.js";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./tabs.js";

// Every story in this file is transcribed verbatim from the shadcn Tabs docs
// examples (https://ui.shadcn.com/docs/components/radix/tabs), so the file
// carries the "shadcn-example" provenance tag at the meta level.
// Compatibility is about usage, not which registry an example file lives in
// (packages/ui/AGENTS.md): these examples compose the standard Radix Tabs API
// (`variant="line"` on TabsList, `orientation="vertical"` on Tabs, `disabled`
// on TabsTrigger), all of which our tabs.tsx fully exports — a prior sweep's
// conclusion that Line/Vertical/Disabled/Icons were "incompatible" (from
// checking the wrong, largely-404 `registry/new-york-v4/examples/` path) was
// wrong. The correct source is `apps/v4/examples/radix/tabs-<x>.tsx` on
// GitHub main, the files the docs' "Radix UI" tab renders. The page's lead,
// unanchored preview (`tabs-demo.tsx`, transcribed below as `Basic`) has no
// docs-page heading/anchor of its own — it sits above "## Installation" as
// the page's introductory preview, same precedent as accordion.stories.tsx's
// `Basic`. (The prior sweep's `Basic` content — an Account/Password
// form-fields demo — was a stale, no-longer-current transcription; replaced
// below with the current `tabs-demo.tsx`.) The Line/Vertical/Disabled/Icons
// stories add an empty `TabsContent` per trigger (not present upstream)
// solely to keep Radix's implicit aria-controls valid without introducing
// placeholder panel content — a required a11y fork, not a deviation from
// verbatim fidelity. RTL is skipped by convention.
const meta = {
  component: Tabs,
  subcomponents: {
    TabsContent,
    TabsList,
    TabsTrigger,
  },
  parameters: {
    layout: "centered",
  },
  // Mirror the docs' ComponentPreview frame: center each example and
  // width-constrain it to a single width, so the verbatim per-example widths
  // (`tabs-demo` is `w-[400px]`, the rest are unsized) render uniformly here
  // instead of a zoo of sizes.
  decorators: [
    (Story) => (
      <div className="w-[26rem] max-w-full">
        <Story />
      </div>
    ),
  ],
  tags: ["autodocs", "shadcn-example", "ai-generated"],
} satisfies Meta<typeof Tabs>;

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * Use for switching between peer sections backed by descriptive content
 * panels; the play function verifies the active tab moves and its panel's
 * content swaps in.
 *
 * Verbatim from the [shadcn Tabs demo](https://ui.shadcn.com/docs/components/radix/tabs).
 *
 * @summary for the standard boxed tabs with panels
 */
export const Basic: Story = {
  render: () => (
    <Tabs defaultValue="overview">
      <TabsList>
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="analytics">Analytics</TabsTrigger>
        <TabsTrigger value="reports">Reports</TabsTrigger>
        <TabsTrigger value="settings">Settings</TabsTrigger>
      </TabsList>
      <TabsContent value="overview">
        <Card>
          <CardHeader>
            <CardTitle>Overview</CardTitle>
            <CardDescription>
              View your key metrics and recent project activity. Track progress
              across all your active projects.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            You have 12 active projects and 3 pending tasks.
          </CardContent>
        </Card>
      </TabsContent>
      <TabsContent value="analytics">
        <Card>
          <CardHeader>
            <CardTitle>Analytics</CardTitle>
            <CardDescription>
              Track performance and user engagement metrics. Monitor trends and
              identify growth opportunities.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Page views are up 25% compared to last month.
          </CardContent>
        </Card>
      </TabsContent>
      <TabsContent value="reports">
        <Card>
          <CardHeader>
            <CardTitle>Reports</CardTitle>
            <CardDescription>
              Generate and download your detailed reports. Export data in
              multiple formats for analysis.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            You have 5 reports ready and available to export.
          </CardContent>
        </Card>
      </TabsContent>
      <TabsContent value="settings">
        <Card>
          <CardHeader>
            <CardTitle>Settings</CardTitle>
            <CardDescription>
              Manage your account preferences and options. Customize your
              experience to fit your needs.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Configure notifications, security, and themes.
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  ),
  play: async ({ canvas, userEvent }) => {
    const tabsList = canvas.getByRole("tablist");
    const overviewTab = within(tabsList).getByRole("tab", {
      name: "Overview",
    });
    const reportsTab = within(tabsList).getByRole("tab", { name: "Reports" });

    await expect(overviewTab).toHaveAttribute("data-state", "active");
    await userEvent.click(reportsTab);
    await expect(reportsTab).toHaveAttribute("data-state", "active");
    await expect(overviewTab).toHaveAttribute("data-state", "inactive");
    await expect(
      canvas.getByText(/Generate and download your detailed reports/),
    ).toBeVisible();
  },
};

/**
 * Use `variant="line"` for a lighter underlined tab list that sits flush on
 * the page surface.
 *
 * Verbatim from [shadcn Tabs › Line](https://ui.shadcn.com/docs/components/radix/tabs#line).
 *
 * @summary for the underlined line variant
 */
export const Line: Story = {
  args: {
    defaultValue: "overview",
    children: (
      <>
        <TabsList variant="line">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
          <TabsTrigger value="reports">Reports</TabsTrigger>
        </TabsList>
        {/* Keeps Radix's implicit aria-controls valid without adding placeholder panel content. */}
        <TabsContent value="overview" />
        <TabsContent value="analytics" />
        <TabsContent value="reports" />
      </>
    ),
  },
  play: async ({ canvas, userEvent }) => {
    const analyticsTab = canvas.getByRole("tab", { name: "Analytics" });
    await userEvent.click(analyticsTab);
    await expect(analyticsTab).toHaveAttribute("data-state", "active");
  },
};

/**
 * Use `orientation="vertical"` when tabs act as side navigation for
 * settings-like sections.
 *
 * Verbatim from [shadcn Tabs › Vertical](https://ui.shadcn.com/docs/components/radix/tabs#vertical).
 *
 * @summary for vertical side-nav tabs
 */
export const Vertical: Story = {
  args: {
    defaultValue: "account",
    orientation: "vertical",
    children: (
      <>
        <TabsList>
          <TabsTrigger value="account">Account</TabsTrigger>
          <TabsTrigger value="password">Password</TabsTrigger>
          <TabsTrigger value="notifications">Notifications</TabsTrigger>
        </TabsList>
        {/* Keeps Radix's implicit aria-controls valid without adding placeholder panel content. */}
        <TabsContent value="account" />
        <TabsContent value="password" />
        <TabsContent value="notifications" />
      </>
    ),
  },
  play: async ({ canvas, userEvent }) => {
    const accountTab = canvas.getByRole("tab", { name: "Account" });
    const notificationsTab = canvas.getByRole("tab", {
      name: "Notifications",
    });

    await expect(accountTab).toHaveAttribute("data-state", "active");
    await userEvent.click(notificationsTab);
    await expect(notificationsTab).toHaveAttribute("data-state", "active");
    await expect(accountTab).toHaveAttribute("data-state", "inactive");
  },
};

/**
 * Use `disabled` on a TabsTrigger for temporarily unavailable sections; the
 * play function verifies it cannot activate.
 *
 * Verbatim from [shadcn Tabs › Disabled](https://ui.shadcn.com/docs/components/radix/tabs#disabled).
 *
 * @summary for disabling individual tabs
 */
export const Disabled: Story = {
  args: {
    defaultValue: "home",
    children: (
      <>
        <TabsList>
          <TabsTrigger value="home">Home</TabsTrigger>
          <TabsTrigger value="settings" disabled>
            Disabled
          </TabsTrigger>
        </TabsList>
        {/* Keeps Radix's implicit aria-controls valid without adding placeholder panel content. */}
        <TabsContent value="home" />
        <TabsContent value="settings" />
      </>
    ),
  },
  play: async ({ canvas }) => {
    const homeTab = canvas.getByRole("tab", { name: "Home" });
    const disabledTab = canvas.getByRole("tab", { name: "Disabled" });

    await expect(disabledTab).toBeDisabled();
    await expect(disabledTab).toHaveAttribute("data-state", "inactive");
    await expect(homeTab).toHaveAttribute("data-state", "active");
  },
};

/**
 * Use a leading icon in the trigger when tabs represent modes (preview vs
 * code); icon and label render inline.
 *
 * Verbatim from [shadcn Tabs › Icons](https://ui.shadcn.com/docs/components/radix/tabs#icons).
 *
 * @summary for tabs with leading icons
 */
export const Icons: Story = {
  args: {
    defaultValue: "preview",
    children: (
      <>
        <TabsList>
          <TabsTrigger value="preview">
            <AppWindowIcon />
            Preview
          </TabsTrigger>
          <TabsTrigger value="code">
            <CodeIcon />
            Code
          </TabsTrigger>
        </TabsList>
        {/* Keeps Radix's implicit aria-controls valid without adding placeholder panel content. */}
        <TabsContent value="preview" />
        <TabsContent value="code" />
      </>
    ),
  },
  play: async ({ canvas, userEvent }) => {
    const previewTab = canvas.getByRole("tab", { name: "Preview" });
    const codeTab = canvas.getByRole("tab", { name: "Code" });

    await expect(previewTab).toHaveAttribute("data-state", "active");
    await userEvent.click(codeTab);
    await expect(codeTab).toHaveAttribute("data-state", "active");
    await expect(previewTab).toHaveAttribute("data-state", "inactive");
  },
};
