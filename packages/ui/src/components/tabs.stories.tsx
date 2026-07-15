import { LockIcon, UserIcon } from "lucide-react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import type { ComponentProps } from "react";
import { expect, within } from "storybook/test";

import { Button } from "./button.js";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "./card.js";
import { Input } from "./input.js";
import { Label } from "./label.js";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./tabs.js";

const meta: Meta<typeof Tabs> = {
  component: Tabs,
  subcomponents: {
    TabsContent,
    TabsList,
    TabsTrigger,
  },
  decorators: [
    (Story) => (
      <div className="w-full max-w-sm">
        <Story />
      </div>
    ),
  ],
  parameters: {
    layout: "padded",
  },
  tags: ["autodocs"],
  argTypes: {},
  play: async ({ canvas, userEvent }) => {
    const tabsList = canvas.getByRole("tablist");
    await expect(tabsList).toBeInTheDocument();

    const accountTab = within(tabsList).getByRole("tab", { name: "Account" });
    const passwordTab = within(tabsList).getByRole("tab", {
      name: "Password",
    });

    await expect(accountTab).toHaveAttribute("data-state", "active");
    await userEvent.click(passwordTab);
    await expect(passwordTab).toHaveAttribute("data-state", "active");
    await expect(accountTab).toHaveAttribute("data-state", "inactive");

    const passwordContent = canvas.getByRole("tabpanel");
    await expect(within(passwordContent).getByText("Password")).toBeVisible();
  },
};

export default meta;

type Story = StoryObj<typeof meta>;

function AccountTabs({
  icons = false,
  variant = "default",
  ...props
}: {
  icons?: boolean;
  variant?: "default" | "line";
} & ComponentProps<typeof Tabs>) {
  return (
    <Tabs {...props}>
      <TabsList variant={variant}>
        <TabsTrigger value="account">
          {icons && <UserIcon />}
          Account
        </TabsTrigger>
        <TabsTrigger value="password">
          {icons && <LockIcon />}
          Password
        </TabsTrigger>
      </TabsList>
      <TabsContent value="account">
        <Card className="py-6">
          <CardHeader>
            <CardTitle>Account</CardTitle>
            <CardDescription>
              Make changes to your account here. Click save when you&apos;re
              done.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-6">
            <div className="grid gap-3">
              <Label htmlFor="tabs-demo-name">Name</Label>
              <Input defaultValue="Pedro Duarte" id="tabs-demo-name" />
            </div>
            <div className="grid gap-3">
              <Label htmlFor="tabs-demo-username">Username</Label>
              <Input defaultValue="@peduarte" id="tabs-demo-username" />
            </div>
          </CardContent>
          <CardFooter>
            <Button>Save changes</Button>
          </CardFooter>
        </Card>
      </TabsContent>
      <TabsContent value="password">
        <Card className="py-6">
          <CardHeader>
            <CardTitle>Password</CardTitle>
            <CardDescription>
              Change your password here. After saving, you&apos;ll be logged
              out.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-6">
            <div className="grid gap-3">
              <Label htmlFor="tabs-demo-current">Current password</Label>
              <Input id="tabs-demo-current" type="password" />
            </div>
            <div className="grid gap-3">
              <Label htmlFor="tabs-demo-new">New password</Label>
              <Input id="tabs-demo-new" type="password" />
            </div>
          </CardContent>
          <CardFooter>
            <Button>Save password</Button>
          </CardFooter>
        </Card>
      </TabsContent>
    </Tabs>
  );
}

export const Default: Story = {
  args: {
    defaultValue: "account",
  },
  render: (args) => <AccountTabs {...args} />,
};

export const WithIcons: Story = {
  args: {
    defaultValue: "account",
  },
  render: (args) => <AccountTabs {...args} icons />,
};

export const Line: Story = {
  args: {
    defaultValue: "account",
  },
  render: (args) => <AccountTabs {...args} variant="line" />,
};

export const Simple: Story = {
  args: {
    defaultValue: "tab1",
  },
  render: (args) => (
    <Tabs {...args}>
      <TabsList>
        <TabsTrigger value="tab1">Tab 1</TabsTrigger>
        <TabsTrigger value="tab2">Tab 2</TabsTrigger>
        <TabsTrigger value="tab3">Tab 3</TabsTrigger>
      </TabsList>
      <TabsContent value="tab1">
        <p className="text-sm">Content for tab 1</p>
      </TabsContent>
      <TabsContent value="tab2">
        <p className="text-sm">Content for tab 2</p>
      </TabsContent>
      <TabsContent value="tab3">
        <p className="text-sm">Content for tab 3</p>
      </TabsContent>
    </Tabs>
  ),
  play: async ({ canvas, userEvent }) => {
    const tabsList = canvas.getByRole("tablist");
    const tab1 = within(tabsList).getByRole("tab", { name: "Tab 1" });
    const tab2 = within(tabsList).getByRole("tab", { name: "Tab 2" });
    const tab3 = within(tabsList).getByRole("tab", { name: "Tab 3" });

    await userEvent.click(tab2);
    await expect(tab2).toHaveAttribute("data-state", "active");
    await expect(canvas.getByRole("tabpanel")).toHaveTextContent(
      "Content for tab 2",
    );

    await userEvent.click(tab3);
    await expect(tab3).toHaveAttribute("data-state", "active");
    await expect(canvas.getByRole("tabpanel")).toHaveTextContent(
      "Content for tab 3",
    );
    await expect(tab1).toHaveAttribute("data-state", "inactive");
  },
};
