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

const meta: Meta<typeof Tabs> = {
  component: Tabs,
  subcomponents: {
    TabsContent,
    TabsList,
    TabsTrigger,
  },
  parameters: {
    layout: "padded",
  },
  tags: ["autodocs", "ai-generated"],
};

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * Use for switching between peer content panels; the play function verifies
 * the active state moves and the panel content swaps.
 *
 * @summary for the standard boxed tabs with panels
 */
export const Basic: Story = {
  render: () => (
    <Tabs defaultValue="overview" className="w-[400px]">
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
    const analyticsTab = within(tabsList).getByRole("tab", {
      name: "Analytics",
    });

    await expect(overviewTab).toHaveAttribute("data-state", "active");
    await userEvent.click(analyticsTab);
    await expect(analyticsTab).toHaveAttribute("data-state", "active");
    await expect(overviewTab).toHaveAttribute("data-state", "inactive");
    await expect(
      within(canvas.getByRole("tabpanel")).getByText(
        "Page views are up 25% compared to last month.",
      ),
    ).toBeVisible();
  },
};

/**
 * Use `variant="line"` for a lighter underlined tab list that sits flush on
 * the page surface.
 *
 * @summary for the underlined line variant
 */
export const Line: Story = {
  render: () => (
    <Tabs defaultValue="overview">
      <TabsList variant="line">
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="analytics">Analytics</TabsTrigger>
        <TabsTrigger value="reports">Reports</TabsTrigger>
      </TabsList>
      {/* Keeps Radix tab aria-controls references valid without changing the docs demo. */}
      <TabsContent value="overview" />
      <TabsContent value="analytics" />
      <TabsContent value="reports" />
    </Tabs>
  ),
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
 * @summary for vertical side-nav tabs
 */
export const Vertical: Story = {
  render: () => (
    <Tabs defaultValue="account" orientation="vertical">
      <TabsList>
        <TabsTrigger value="account">Account</TabsTrigger>
        <TabsTrigger value="password">Password</TabsTrigger>
        <TabsTrigger value="notifications">Notifications</TabsTrigger>
      </TabsList>
      {/* Keeps Radix tab aria-controls references valid without changing the docs demo. */}
      <TabsContent value="account" />
      <TabsContent value="password" />
      <TabsContent value="notifications" />
    </Tabs>
  ),
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
 * @summary for disabling individual tabs
 */
export const Disabled: Story = {
  render: () => (
    <Tabs defaultValue="home">
      <TabsList>
        <TabsTrigger value="home">Home</TabsTrigger>
        <TabsTrigger value="settings" disabled>
          Disabled
        </TabsTrigger>
      </TabsList>
      {/* Keeps Radix tab aria-controls references valid without changing the docs demo. */}
      <TabsContent value="home" />
      <TabsContent value="settings" />
    </Tabs>
  ),
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
 * @summary for tabs with leading icons
 */
export const Icons: Story = {
  render: () => (
    <Tabs defaultValue="preview">
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
      {/* Keeps Radix tab aria-controls references valid without changing the docs demo. */}
      <TabsContent value="preview" />
      <TabsContent value="code" />
    </Tabs>
  ),
  play: async ({ canvas, userEvent }) => {
    const previewTab = canvas.getByRole("tab", { name: "Preview" });
    const codeTab = canvas.getByRole("tab", { name: "Code" });

    await expect(previewTab).toHaveAttribute("data-state", "active");
    await userEvent.click(codeTab);
    await expect(codeTab).toHaveAttribute("data-state", "active");
    await expect(previewTab).toHaveAttribute("data-state", "inactive");
  },
};
