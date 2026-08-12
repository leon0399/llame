import * as React from "react";
import { AppWindowIcon, CodeIcon } from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@workspace/ui/components/tabs";
import * as S from "@ds-stories/packages/ui/src/components/tabs.stories";

// Basic/Line/Vertical/Icons each have a play function that switches the
// active tab AFTER the initial render (the interaction-driven-content
// limitation documented in .ds-sync/storybook/SKILL.md §4a — compiled
// previews never run play). The storybook reference screenshot is captured
// POST-play, so those stories mirror the story's JSX verbatim but with
// `defaultValue` set to that post-play end tab instead of the story's own
// pre-interaction default. Disabled's play never changes the active tab, so
// it's composed unchanged from the story module.

const frame = "w-[26rem] max-w-full";

export const Basic = () => (
  <div className={frame}>
    {/* play clicks "Reports" — ends selected (was: overview) */}
    <Tabs defaultValue="reports">
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
  </div>
);

export const Line = () => (
  <div className={frame}>
    {/* play clicks "Analytics" — ends selected (was: overview) */}
    <Tabs defaultValue="analytics">
      <TabsList variant="line">
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="analytics">Analytics</TabsTrigger>
        <TabsTrigger value="reports">Reports</TabsTrigger>
      </TabsList>
      <TabsContent value="overview" />
      <TabsContent value="analytics" />
      <TabsContent value="reports" />
    </Tabs>
  </div>
);

export const Vertical = () => (
  <div className={frame}>
    {/* play clicks "Notifications" — ends selected (was: account) */}
    <Tabs defaultValue="notifications" orientation="vertical">
      <TabsList>
        <TabsTrigger value="account">Account</TabsTrigger>
        <TabsTrigger value="password">Password</TabsTrigger>
        <TabsTrigger value="notifications">Notifications</TabsTrigger>
      </TabsList>
      <TabsContent value="account" />
      <TabsContent value="password" />
      <TabsContent value="notifications" />
    </Tabs>
  </div>
);

// Disabled's play only asserts state — the active tab never changes, so it
// renders the story module's own args unchanged (just re-wrapped in the
// meta decorator's frame div, applied by hand since this file bypasses the
// generated compose()/decorator plumbing).
function renderDisabled() {
  const meta: any = (S as any).default ?? {};
  const st: any = (S as any).Disabled;
  const args: any = { ...(meta.args ?? {}), ...(st && st.args ? st.args : {}) };
  const C = (st && st.component) || meta.component;
  return C ? React.createElement(C, args) : null;
}
export const Disabled = () => <div className={frame}>{renderDisabled()}</div>;

export const Icons = () => (
  <div className={frame}>
    {/* play clicks "Code" — ends selected (was: preview) */}
    <Tabs defaultValue="code">
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
      <TabsContent value="preview" />
      <TabsContent value="code" />
    </Tabs>
  </div>
);
