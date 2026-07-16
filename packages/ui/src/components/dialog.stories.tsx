import * as React from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { InfoIcon } from "lucide-react";
import { expect, screen, waitFor } from "storybook/test";

import { Button } from "./button.js";
import { Checkbox } from "./checkbox.js";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./dialog.js";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldSeparator,
  FieldSet,
  FieldTitle,
} from "./field.js";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "./input-group.js";
import { Input } from "./input.js";
import { Kbd } from "./kbd.js";
import { Label } from "./label.js";
import { NativeSelect, NativeSelectOption } from "./native-select.js";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "./select.js";
import { Switch } from "./switch.js";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./tabs.js";
import { Textarea } from "./textarea.js";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./tooltip.js";

const meta = {
  component: Dialog,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof Dialog>;

export default meta;

type Story = StoryObj<typeof meta>;

const loremIpsum =
  "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.";

function DialogWithForm() {
  return (
    <Dialog>
      <form>
        <DialogTrigger asChild>
          <Button variant="outline">Open Dialog</Button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Edit profile</DialogTitle>
            <DialogDescription>
              Make changes to your profile here. Click save when you&apos;re
              done.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <Label htmlFor="name-1">Name</Label>
              <Input id="name-1" name="name" defaultValue="Pedro Duarte" />
            </Field>
            <Field>
              <Label htmlFor="username-1">Username</Label>
              <Input id="username-1" name="username" defaultValue="@peduarte" />
            </Field>
          </FieldGroup>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button type="submit">Save changes</Button>
          </DialogFooter>
        </DialogContent>
      </form>
    </Dialog>
  );
}

export const Default: Story = {
  render: () => <DialogWithForm />,
  play: async ({ canvas, userEvent }) => {
    const trigger = canvas.getByRole("button", { name: "Open Dialog" });

    await userEvent.click(trigger);

    const dialog = await screen.findByRole("dialog", { name: "Edit profile" });
    await expect(dialog).toHaveAccessibleDescription(
      "Make changes to your profile here. Click save when you're done.",
    );
    await expect(screen.getByLabelText("Name")).toHaveValue("Pedro Duarte");
    await expect(screen.getByLabelText("Username")).toHaveValue("@peduarte");

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    await expect(trigger).toHaveFocus();
  },
};

function DialogWithCustomCloseButton() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline">Share</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Share link</DialogTitle>
          <DialogDescription>
            Anyone who has this link will be able to view this.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2">
          <div className="grid flex-1 gap-2">
            <Label htmlFor="link" className="sr-only">
              Link
            </Label>
            <Input
              id="link"
              defaultValue="https://ui.shadcn.com/docs/installation"
              readOnly
            />
          </div>
        </div>
        <DialogFooter className="sm:justify-start">
          <DialogClose asChild>
            <Button type="button">Close</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export const CustomCloseButton: Story = {
  render: () => <DialogWithCustomCloseButton />,
  play: async ({ canvas, userEvent }) => {
    const trigger = canvas.getByRole("button", { name: "Share" });

    await userEvent.click(trigger);
    const dialog = await screen.findByRole("dialog", { name: "Share link" });
    await expect(dialog).toHaveAccessibleDescription(
      "Anyone who has this link will be able to view this.",
    );
    await expect(screen.getByLabelText("Link")).toHaveValue(
      "https://ui.shadcn.com/docs/installation",
    );

    const closeButton = dialog.querySelector<HTMLButtonElement>(
      '[data-slot="dialog-footer"] button',
    );
    await expect(closeButton).not.toBeNull();
    await userEvent.click(closeButton!);
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    await expect(trigger).toHaveFocus();
  },
};

function DialogWithoutCloseButton() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline">No Close Button</Button>
      </DialogTrigger>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>No Close Button</DialogTitle>
          <DialogDescription>
            This dialog doesn&apos;t have a close button in the top-right
            corner.
          </DialogDescription>
        </DialogHeader>
      </DialogContent>
    </Dialog>
  );
}

export const NoCloseButton: Story = {
  render: () => <DialogWithoutCloseButton />,
  play: async ({ canvas, userEvent }) => {
    const trigger = canvas.getByRole("button", { name: "No Close Button" });

    await userEvent.click(trigger);
    const dialog = await screen.findByRole("dialog", {
      name: "No Close Button",
    });
    await expect(dialog).toHaveAccessibleDescription(
      "This dialog doesn't have a close button in the top-right corner.",
    );
    await expect(
      screen.queryByRole("button", { name: "Close" }),
    ).not.toBeInTheDocument();

    await userEvent.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    await expect(trigger).toHaveFocus();
  },
};

function DialogWithStickyFooter() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline">Sticky Footer</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Sticky Footer</DialogTitle>
          <DialogDescription>
            This dialog has a sticky footer that stays visible while the content
            scrolls.
          </DialogDescription>
        </DialogHeader>
        <div
          className="-mx-4 no-scrollbar max-h-[50vh] overflow-y-auto px-4"
          tabIndex={0}
        >
          {Array.from({ length: 10 }).map((_, index) => (
            <p key={index} className="mb-4 leading-normal">
              {loremIpsum}
            </p>
          ))}
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Close</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export const StickyFooter: Story = {
  render: () => <DialogWithStickyFooter />,
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      canvas.getByRole("button", { name: "Sticky Footer" }),
    );

    const dialog = await screen.findByRole("dialog", { name: "Sticky Footer" });
    await expect(dialog).toHaveAccessibleDescription(
      "This dialog has a sticky footer that stays visible while the content scrolls.",
    );
    await expect(
      dialog.querySelector(".no-scrollbar")?.querySelectorAll("p"),
    ).toHaveLength(10);
    await expect(
      dialog.querySelector('[data-slot="dialog-footer"] button'),
    ).toBeVisible();
  },
};

function DialogWithScrollableContent() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline">Scrollable Content</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Scrollable Content</DialogTitle>
          <DialogDescription>
            This is a dialog with scrollable content.
          </DialogDescription>
        </DialogHeader>
        <div
          className="-mx-4 no-scrollbar max-h-[50vh] overflow-y-auto px-4"
          tabIndex={0}
        >
          {Array.from({ length: 10 }).map((_, index) => (
            <p key={index} className="mb-4 leading-normal">
              {loremIpsum}
            </p>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export const ScrollableContent: Story = {
  render: () => <DialogWithScrollableContent />,
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      canvas.getByRole("button", { name: "Scrollable Content" }),
    );

    const dialog = await screen.findByRole("dialog", {
      name: "Scrollable Content",
    });
    await expect(dialog).toHaveAccessibleDescription(
      "This is a dialog with scrollable content.",
    );
    await expect(
      dialog.querySelector(".no-scrollbar")?.querySelectorAll("p"),
    ).toHaveLength(10);
  },
};

const spokenLanguages = [
  { label: "English", value: "en" },
  { label: "Spanish", value: "es" },
  { label: "French", value: "fr" },
  { label: "German", value: "de" },
  { label: "Italian", value: "it" },
  { label: "Portuguese", value: "pt" },
  { label: "Russian", value: "ru" },
  { label: "Chinese", value: "zh" },
  { label: "Japanese", value: "ja" },
  { label: "Korean", value: "ko" },
  { label: "Arabic", value: "ar" },
  { label: "Hindi", value: "hi" },
  { label: "Bengali", value: "bn" },
  { label: "Telugu", value: "te" },
  { label: "Marathi", value: "mr" },
  { label: "Kannada", value: "kn" },
  { label: "Malayalam", value: "ml" },
];

const voices = [
  { label: "Samantha", value: "samantha" },
  { label: "Alex", value: "alex" },
  { label: "Fred", value: "fred" },
  { label: "Victoria", value: "victoria" },
  { label: "Tom", value: "tom" },
  { label: "Karen", value: "karen" },
  { label: "Sam", value: "sam" },
  { label: "Daniel", value: "daniel" },
];

function DialogChatSettings() {
  const [tab, setTab] = React.useState("general");
  const [theme, setTheme] = React.useState("system");
  const [accentColor, setAccentColor] = React.useState("default");
  const [spokenLanguage, setSpokenLanguage] = React.useState("en");
  const [voice, setVoice] = React.useState("samantha");

  return (
    <TooltipProvider>
      <Dialog>
        <DialogTrigger asChild>
          <Button variant="outline">Chat Settings</Button>
        </DialogTrigger>
        <DialogContent className="min-w-md">
          <DialogHeader>
            <DialogTitle>Chat Settings</DialogTitle>
            <DialogDescription>
              Customize your chat settings: theme, accent color, spoken
              language, voice, personality, and custom instructions.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <NativeSelect
              value={tab}
              onChange={(event) => setTab(event.target.value)}
              className="w-full md:hidden"
            >
              <NativeSelectOption value="general">General</NativeSelectOption>
              <NativeSelectOption value="notifications">
                Notifications
              </NativeSelectOption>
              <NativeSelectOption value="personalization">
                Personalization
              </NativeSelectOption>
              <NativeSelectOption value="security">Security</NativeSelectOption>
            </NativeSelect>
            <Tabs value={tab} onValueChange={setTab}>
              <TabsList className="hidden w-full md:flex">
                <TabsTrigger value="general">General</TabsTrigger>
                <TabsTrigger value="notifications">Notifications</TabsTrigger>
                <TabsTrigger value="personalization">
                  Personalization
                </TabsTrigger>
                <TabsTrigger value="security">Security</TabsTrigger>
              </TabsList>
              <div className="border **:data-[slot=select-trigger]:min-w-[125px] style-vega:min-h-[550px] style-vega:rounded-lg style-vega:p-6 style-nova:min-h-[460px] style-nova:rounded-lg style-nova:p-4 style-lyra:min-h-[450px] style-lyra:rounded-none style-lyra:p-4 style-maia:min-h-[550px] style-maia:rounded-xl style-maia:p-6 style-mira:min-h-[450px] style-mira:rounded-md style-mira:p-4 style-luma:min-h-[550px] style-luma:rounded-xl style-luma:p-6 style-rhea:min-h-[480px] style-rhea:rounded-2xl style-rhea:p-6">
                <TabsContent value="general">
                  <FieldSet>
                    <FieldGroup>
                      <Field orientation="horizontal">
                        <FieldLabel htmlFor="theme">Theme</FieldLabel>
                        <Select value={theme} onValueChange={setTheme}>
                          <SelectTrigger id="theme">
                            <SelectValue placeholder="Select" />
                          </SelectTrigger>
                          <SelectContent align="end">
                            <SelectGroup>
                              <SelectItem value="light">Light</SelectItem>
                              <SelectItem value="dark">Dark</SelectItem>
                              <SelectItem value="system">System</SelectItem>
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                      </Field>
                      <FieldSeparator />
                      <Field orientation="horizontal">
                        <FieldLabel htmlFor="accent-color">
                          Accent Color
                        </FieldLabel>
                        <Select
                          value={accentColor}
                          onValueChange={setAccentColor}
                        >
                          <SelectTrigger id="accent-color">
                            <SelectValue placeholder="Select" />
                          </SelectTrigger>
                          <SelectContent align="end">
                            <SelectGroup>
                              <SelectItem value="default">
                                <div className="size-3 rounded-full bg-neutral-500 dark:bg-neutral-400" />
                                Default
                              </SelectItem>
                              <SelectItem value="red">
                                <div className="size-3 rounded-full bg-red-500 dark:bg-red-400" />
                                Red
                              </SelectItem>
                              <SelectItem value="blue">
                                <div className="size-3 rounded-full bg-blue-500 dark:bg-blue-400" />
                                Blue
                              </SelectItem>
                              <SelectItem value="green">
                                <div className="size-3 rounded-full bg-green-500 dark:bg-green-400" />
                                Green
                              </SelectItem>
                              <SelectItem value="purple">
                                <div className="size-3 rounded-full bg-purple-500 dark:bg-purple-400" />
                                Purple
                              </SelectItem>
                              <SelectItem value="pink">
                                <div className="size-3 rounded-full bg-pink-500 dark:bg-pink-400" />
                                Pink
                              </SelectItem>
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                      </Field>
                      <FieldSeparator />
                      <Field orientation="responsive">
                        <FieldContent>
                          <FieldLabel htmlFor="spoken-language">
                            Spoken Language
                          </FieldLabel>
                          <FieldDescription>
                            For best results, select the language you mainly
                            speak. If it&apos;s not listed, it may still be
                            supported via auto-detection.
                          </FieldDescription>
                        </FieldContent>
                        <Select
                          value={spokenLanguage}
                          onValueChange={setSpokenLanguage}
                        >
                          <SelectTrigger id="spoken-language">
                            <SelectValue placeholder="Select" />
                          </SelectTrigger>
                          <SelectContent align="end" position="item-aligned">
                            <SelectGroup>
                              <SelectItem value="auto">Auto</SelectItem>
                            </SelectGroup>
                            <SelectSeparator />
                            <SelectGroup>
                              {spokenLanguages.map((language) => (
                                <SelectItem
                                  key={language.value}
                                  value={language.value}
                                >
                                  {language.label}
                                </SelectItem>
                              ))}
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                      </Field>
                      <FieldSeparator />
                      <Field orientation="horizontal">
                        <FieldLabel htmlFor="voice">Voice</FieldLabel>
                        <Select value={voice} onValueChange={setVoice}>
                          <SelectTrigger id="voice">
                            <SelectValue placeholder="Select" />
                          </SelectTrigger>
                          <SelectContent align="end" position="item-aligned">
                            <SelectGroup>
                              {voices.map((voiceOption) => (
                                <SelectItem
                                  key={voiceOption.value}
                                  value={voiceOption.value}
                                >
                                  {voiceOption.label}
                                </SelectItem>
                              ))}
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                      </Field>
                    </FieldGroup>
                  </FieldSet>
                </TabsContent>
                <TabsContent value="notifications">
                  <FieldGroup>
                    <FieldSet>
                      <FieldLabel>Responses</FieldLabel>
                      <FieldDescription>
                        Get notified when ChatGPT responds to requests that take
                        time, like research or image generation.
                      </FieldDescription>
                      <FieldGroup data-slot="checkbox-group">
                        <Field orientation="horizontal">
                          <Checkbox id="push" defaultChecked disabled />
                          <FieldLabel htmlFor="push" className="font-normal">
                            Push notifications
                          </FieldLabel>
                        </Field>
                      </FieldGroup>
                    </FieldSet>
                    <FieldSeparator />
                    <FieldSet>
                      <FieldLabel>Tasks</FieldLabel>
                      <FieldDescription>
                        Get notified when tasks you&apos;ve created have
                        updates. <a href="#">Manage tasks</a>
                      </FieldDescription>
                      <FieldGroup data-slot="checkbox-group">
                        <Field orientation="horizontal">
                          <Checkbox id="push-tasks" />
                          <FieldLabel
                            htmlFor="push-tasks"
                            className="font-normal"
                          >
                            Push notifications
                          </FieldLabel>
                        </Field>
                        <Field orientation="horizontal">
                          <Checkbox id="email-tasks" />
                          <FieldLabel
                            htmlFor="email-tasks"
                            className="font-normal"
                          >
                            Email notifications
                          </FieldLabel>
                        </Field>
                      </FieldGroup>
                    </FieldSet>
                  </FieldGroup>
                </TabsContent>
                <TabsContent value="personalization">
                  <FieldGroup>
                    <Field orientation="responsive">
                      <FieldLabel htmlFor="nickname">Nickname</FieldLabel>
                      <InputGroup>
                        <InputGroupInput
                          id="nickname"
                          placeholder="Broski"
                          className="@md/field-group:max-w-[200px]"
                        />
                        <InputGroupAddon align="inline-end">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <InputGroupButton
                                size="icon-xs"
                                aria-label="Nickname help"
                              >
                                <InfoIcon />
                              </InputGroupButton>
                            </TooltipTrigger>
                            <TooltipContent className="flex items-center gap-2">
                              Used to identify you in the chat. <Kbd>N</Kbd>
                            </TooltipContent>
                          </Tooltip>
                        </InputGroupAddon>
                      </InputGroup>
                    </Field>
                    <FieldSeparator />
                    <Field
                      orientation="responsive"
                      className="@md/field-group:flex-col @2xl/field-group:flex-row"
                    >
                      <FieldContent>
                        <FieldLabel htmlFor="about">More about you</FieldLabel>
                        <FieldDescription>
                          Tell us more about yourself. This will be used to help
                          us personalize your experience.
                        </FieldDescription>
                      </FieldContent>
                      <Textarea
                        id="about"
                        placeholder="I'm a software engineer..."
                        className="min-h-[120px] @md/field-group:min-w-full @2xl/field-group:min-w-[300px]"
                      />
                    </Field>
                    <FieldSeparator />
                    <FieldLabel>
                      <Field orientation="horizontal">
                        <FieldContent>
                          <FieldLabel htmlFor="customization">
                            Enable customizations
                          </FieldLabel>
                          <FieldDescription>
                            Enable customizations to make ChatGPT more
                            personalized.
                          </FieldDescription>
                        </FieldContent>
                        <Switch id="customization" defaultChecked />
                      </Field>
                    </FieldLabel>
                  </FieldGroup>
                </TabsContent>
                <TabsContent value="security">
                  <FieldGroup>
                    <Field orientation="horizontal">
                      <FieldContent>
                        <FieldLabel htmlFor="2fa">
                          Multi-factor authentication
                        </FieldLabel>
                        <FieldDescription>
                          Enable multi-factor authentication to secure your
                          account. If you do not have a two-factor
                          authentication device, you can use a one-time code
                          sent to your email.
                        </FieldDescription>
                      </FieldContent>
                      <Switch id="2fa" />
                    </Field>
                    <FieldSeparator />
                    <Field orientation="horizontal">
                      <FieldContent>
                        <FieldTitle>Log out</FieldTitle>
                        <FieldDescription>
                          Log out of your account on this device.
                        </FieldDescription>
                      </FieldContent>
                      <Button variant="outline" size="sm">
                        Log Out
                      </Button>
                    </Field>
                    <FieldSeparator />
                    <Field orientation="horizontal">
                      <FieldContent>
                        <FieldTitle>Log out of all devices</FieldTitle>
                        <FieldDescription>
                          This will log you out of all devices, including the
                          current session. It may take up to 30 minutes for the
                          changes to take effect.
                        </FieldDescription>
                      </FieldContent>
                      <Button variant="outline" size="sm">
                        Log Out All
                      </Button>
                    </Field>
                  </FieldGroup>
                </TabsContent>
              </div>
            </Tabs>
          </div>
        </DialogContent>
      </Dialog>
    </TooltipProvider>
  );
}

export const ChatSettings: Story = {
  render: () => <DialogChatSettings />,
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      canvas.getByRole("button", { name: "Chat Settings" }),
    );

    const dialog = await screen.findByRole("dialog", { name: "Chat Settings" });
    await expect(dialog).toHaveAccessibleDescription(
      "Customize your chat settings: theme, accent color, spoken language, voice, personality, and custom instructions.",
    );
    await expect(screen.getByRole("tab", { name: "General" })).toHaveAttribute(
      "data-state",
      "active",
    );
    await expect(
      screen.getByRole("combobox", { name: "Theme" }),
    ).toHaveTextContent("System");

    await userEvent.click(screen.getByRole("tab", { name: "Notifications" }));
    await expect(screen.getByText("Responses")).toBeVisible();
    await expect(
      screen.getAllByRole("checkbox", { name: "Push notifications" })[0],
    ).toBeChecked();

    await userEvent.click(screen.getByRole("tab", { name: "Personalization" }));
    await expect(screen.getByLabelText("Enable customizations")).toBeChecked();

    await userEvent.click(screen.getByRole("tab", { name: "Security" }));
    await expect(
      screen.getByRole("button", { name: "Log Out All" }),
    ).toBeVisible();
  },
};
