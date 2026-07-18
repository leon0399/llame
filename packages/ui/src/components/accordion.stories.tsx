import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, waitFor } from "storybook/test";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "./accordion.js";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./card.js";

// Every story in this file is transcribed verbatim from the shadcn Accordion
// docs examples (https://ui.shadcn.com/docs/components/radix/accordion), so
// the file carries the "shadcn-example" provenance tag at the meta level.
// Compatibility is about usage, not which registry an example file lives in
// (packages/ui/AGENTS.md): these examples compose the standard Radix
// Accordion API, which our accordion.tsx fully exports, so a prior sweep's
// conclusion that they were "incompatible" (from checking the wrong,
// largely-404 `registry/new-york-v4/examples/` path) was wrong — the correct
// source is `apps/v4/examples/radix/accordion-<x>.tsx` on GitHub main, the
// files the docs' "Radix UI" tab renders. The page's lead, unanchored preview
// (`accordion-demo.tsx`) demonstrates the exact same
// single/collapsible/defaultValue usage as the anchored "## Basic" example
// (`accordion-basic.tsx`, transcribed below as `Basic`) and introduces no new
// prop/subcomponent coverage, so — following the same precedent as
// avatar.stories.tsx's `avatar-demo` — it is not transcribed as a separate
// story. RTL is skipped by convention.
const meta = {
  component: Accordion,
  subcomponents: {
    AccordionContent,
    AccordionItem,
    AccordionTrigger,
  },
  parameters: {
    layout: "centered",
  },
  // Mirror the docs' ComponentPreview frame: center each example and
  // width-constrain it to a single width, so the verbatim per-example widths
  // (most are `max-w-lg`, `disabled` is `w-full`, `card` is `max-w-sm`) render
  // uniformly here instead of the `w-full` one blowing out the canvas.
  decorators: [
    (Story) => (
      <div className="w-[32rem] max-w-full">
        <Story />
      </div>
    ),
  ],
  tags: ["autodocs", "shadcn-example"],
  argTypes: {
    type: {
      control: "radio",
      options: ["single", "multiple"],
      description:
        "Whether only one item can be open at a time (single) or several can be open together (multiple).",
    },
  },
} satisfies Meta<typeof Accordion>;

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * Use `type="single"` with `collapsible` for FAQ/disclosure content where
 * opening one item closes the rest; the play function verifies exclusivity.
 *
 * Verbatim from [shadcn Accordion › Basic](https://ui.shadcn.com/docs/components/radix/accordion#basic).
 *
 * @summary for single-open FAQ-style disclosure
 */
export const Basic: Story = {
  args: { type: "single" },
  // `type` is a discriminated union upstream (single vs. multiple take
  // different value/defaultValue shapes), so it can't be safely spread from
  // args into a hardcoded single-mode tree — the control is fixed per story.
  argTypes: { type: { control: false } },
  render: () => (
    <Accordion type="single" collapsible defaultValue="item-1">
      <AccordionItem value="item-1">
        <AccordionTrigger>How do I reset my password?</AccordionTrigger>
        <AccordionContent>
          Click on &apos;Forgot Password&apos; on the login page, enter your
          email address, and we&apos;ll send you a link to reset your password.
          The link will expire in 24 hours.
        </AccordionContent>
      </AccordionItem>
      <AccordionItem value="item-2">
        <AccordionTrigger>Can I change my subscription plan?</AccordionTrigger>
        <AccordionContent>
          Yes, you can upgrade or downgrade your plan at any time from your
          account settings. Changes will be reflected in your next billing
          cycle.
        </AccordionContent>
      </AccordionItem>
      <AccordionItem value="item-3">
        <AccordionTrigger>What payment methods do you accept?</AccordionTrigger>
        <AccordionContent>
          We accept all major credit cards, PayPal, and bank transfers. All
          payments are processed securely through our payment partners.
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  ),
  play: async ({ canvas, userEvent }) => {
    const firstTrigger = canvas.getByRole("button", {
      name: "How do I reset my password?",
    });
    const secondTrigger = canvas.getByRole("button", {
      name: "Can I change my subscription plan?",
    });

    await expect(firstTrigger).toHaveAttribute("data-state", "open");
    await userEvent.click(secondTrigger);
    await waitFor(() =>
      expect(secondTrigger).toHaveAttribute("data-state", "open"),
    );
    await expect(
      canvas.getByText(/Yes, you can upgrade or downgrade your plan/),
    ).toBeVisible();
    await expect(firstTrigger).toHaveAttribute("data-state", "closed");
  },
};

const multipleItems = [
  {
    value: "notifications",
    trigger: "Notification Settings",
    content:
      "Manage how you receive notifications. You can enable email alerts for updates or push notifications for mobile devices.",
  },
  {
    value: "privacy",
    trigger: "Privacy & Security",
    content:
      "Control your privacy settings and security preferences. Enable two-factor authentication, manage connected devices, review active sessions, and configure data sharing preferences. You can also download your data or delete your account.",
  },
  {
    value: "billing",
    trigger: "Billing & Subscription",
    content:
      "View your current plan, payment history, and upcoming invoices. Update your payment method, change your subscription tier, or cancel your subscription.",
  },
];

/**
 * Use `type="multiple"` when readers need several sections open at once
 * (settings, reference content); the play function verifies items open and
 * close independently.
 *
 * Verbatim from [shadcn Accordion › Multiple](https://ui.shadcn.com/docs/components/radix/accordion#multiple).
 *
 * @summary for independently open sections
 */
export const Multiple: Story = {
  args: { type: "multiple" },
  // See the `type` note on `Basic` — fixed per story, not wired via args.
  argTypes: { type: { control: false } },
  render: () => (
    <Accordion type="multiple" defaultValue={["notifications"]}>
      {multipleItems.map((item) => (
        <AccordionItem key={item.value} value={item.value}>
          <AccordionTrigger>{item.trigger}</AccordionTrigger>
          <AccordionContent>{item.content}</AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  ),
  play: async ({ canvas, userEvent }) => {
    const notificationsTrigger = canvas.getByRole("button", {
      name: "Notification Settings",
    });
    const privacyTrigger = canvas.getByRole("button", {
      name: "Privacy & Security",
    });

    await expect(notificationsTrigger).toHaveAttribute("data-state", "open");
    await userEvent.click(privacyTrigger);
    await waitFor(() =>
      expect(privacyTrigger).toHaveAttribute("data-state", "open"),
    );
    await expect(
      canvas.getByText(
        /Control your privacy settings and security preferences/,
      ),
    ).toBeVisible();
    await expect(notificationsTrigger).toHaveAttribute("data-state", "open");

    await userEvent.click(notificationsTrigger);
    await waitFor(() =>
      expect(notificationsTrigger).toHaveAttribute("data-state", "closed"),
    );
    await expect(privacyTrigger).toHaveAttribute("data-state", "open");
  },
};

/**
 * Use `disabled` on an AccordionItem to keep gated content visible in the
 * list but non-interactive (e.g. plan-gated features).
 *
 * Verbatim from [shadcn Accordion › Disabled](https://ui.shadcn.com/docs/components/radix/accordion#disabled).
 *
 * @summary for gating individual items
 */
export const Disabled: Story = {
  args: { type: "single" },
  // See the `type` note on `Basic` — fixed per story, not wired via args.
  argTypes: { type: { control: false } },
  render: () => (
    <Accordion type="single" collapsible>
      <AccordionItem value="item-1">
        <AccordionTrigger>Can I access my account history?</AccordionTrigger>
        <AccordionContent>
          Yes, you can view your complete account history including all
          transactions, plan changes, and support tickets in the Account History
          section of your dashboard.
        </AccordionContent>
      </AccordionItem>
      <AccordionItem value="item-2" disabled>
        <AccordionTrigger>Premium feature information</AccordionTrigger>
        <AccordionContent>
          This section contains information about premium features. Upgrade your
          plan to access this content.
        </AccordionContent>
      </AccordionItem>
      <AccordionItem value="item-3">
        <AccordionTrigger>How do I update my email address?</AccordionTrigger>
        <AccordionContent>
          You can update your email address in your account settings.
          You&apos;ll receive a verification email at your new address to
          confirm the change.
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  ),
  play: async ({ canvas, userEvent }) => {
    const disabledTrigger = canvas.getByRole("button", {
      name: "Premium feature information",
    });
    const emailTrigger = canvas.getByRole("button", {
      name: "How do I update my email address?",
    });

    await expect(disabledTrigger).toBeDisabled();
    await expect(disabledTrigger).toHaveAttribute("data-state", "closed");

    await userEvent.click(emailTrigger);
    await waitFor(() =>
      expect(emailTrigger).toHaveAttribute("data-state", "open"),
    );
    await expect(
      canvas.getByText(/You can update your email address/),
    ).toBeVisible();
  },
};

const borderedItems = [
  {
    value: "billing",
    trigger: "How does billing work?",
    content:
      "We offer monthly and annual subscription plans. Billing is charged at the beginning of each cycle, and you can cancel anytime. All plans include automatic backups, 24/7 support, and unlimited team members.",
  },
  {
    value: "security",
    trigger: "Is my data secure?",
    content:
      "Yes. We use end-to-end encryption, SOC 2 Type II compliance, and regular third-party security audits. All data is encrypted at rest and in transit using industry-standard protocols.",
  },
  {
    value: "integration",
    trigger: "What integrations do you support?",
    content:
      "We integrate with 500+ popular tools including Slack, Zapier, Salesforce, HubSpot, and more. You can also build custom integrations using our REST API and webhooks.",
  },
];

/**
 * Use the bordered treatment when the accordion sits on an open page surface
 * and needs its own visual container.
 *
 * Verbatim from [shadcn Accordion › Borders](https://ui.shadcn.com/docs/components/radix/accordion#borders).
 *
 * @summary for a self-contained bordered accordion
 */
export const Borders: Story = {
  args: { type: "single" },
  // See the `type` note on `Basic` — fixed per story, not wired via args.
  argTypes: { type: { control: false } },
  render: () => (
    <Accordion
      type="single"
      collapsible
      className="rounded-lg border"
      defaultValue="billing"
    >
      {borderedItems.map((item) => (
        <AccordionItem
          key={item.value}
          value={item.value}
          className="border-b px-4 last:border-b-0"
        >
          <AccordionTrigger>{item.trigger}</AccordionTrigger>
          <AccordionContent>{item.content}</AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  ),
  play: async ({ canvas, userEvent }) => {
    const billingTrigger = canvas.getByRole("button", {
      name: "How does billing work?",
    });
    const securityTrigger = canvas.getByRole("button", {
      name: "Is my data secure?",
    });

    await expect(billingTrigger).toHaveAttribute("data-state", "open");
    await userEvent.click(securityTrigger);
    await waitFor(() =>
      expect(securityTrigger).toHaveAttribute("data-state", "open"),
    );
    await expect(
      canvas.getByText(/Yes\. We use end-to-end encryption/),
    ).toBeVisible();
  },
};

const cardItems = [
  {
    value: "plans",
    trigger: "What subscription plans do you offer?",
    content:
      "We offer three subscription tiers: Starter ($9/month), Professional ($29/month), and Enterprise ($99/month). Each plan includes increasing storage limits, API access, priority support, and team collaboration features.",
  },
  {
    value: "billing",
    trigger: "How does billing work?",
    content:
      "Billing occurs automatically at the start of each billing cycle. We accept all major credit cards, PayPal, and ACH transfers for enterprise customers. You'll receive an invoice via email after each payment.",
  },
  {
    value: "cancel",
    trigger: "How do I cancel my subscription?",
    content:
      "You can cancel your subscription anytime from your account settings. There are no cancellation fees or penalties. Your access will continue until the end of your current billing period.",
  },
];

/**
 * Use inside a Card when the accordion is one section of a larger composed
 * surface; the Card supplies the heading and padding.
 *
 * Verbatim from [shadcn Accordion › Card](https://ui.shadcn.com/docs/components/radix/accordion#card).
 *
 * @summary for composing an accordion inside a Card
 */
export const InCard: Story = {
  args: { type: "single" },
  name: "Card",
  // See the `type` note on `Basic` — fixed per story, not wired via args.
  argTypes: { type: { control: false } },
  render: () => (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>Subscription & Billing</CardTitle>
        <CardDescription>
          Common questions about your account, plans, payments and
          cancellations.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Accordion type="single" collapsible defaultValue="plans">
          {cardItems.map((item) => (
            <AccordionItem key={item.value} value={item.value}>
              <AccordionTrigger>{item.trigger}</AccordionTrigger>
              <AccordionContent>{item.content}</AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </CardContent>
    </Card>
  ),
  play: async ({ canvas, userEvent }) => {
    const plansTrigger = canvas.getByRole("button", {
      name: "What subscription plans do you offer?",
    });
    const billingTrigger = canvas.getByRole("button", {
      name: "How does billing work?",
    });

    await expect(plansTrigger).toHaveAttribute("data-state", "open");
    await userEvent.click(billingTrigger);
    await waitFor(() =>
      expect(billingTrigger).toHaveAttribute("data-state", "open"),
    );
    await expect(
      canvas.getByText(/Billing occurs automatically at the start/),
    ).toBeVisible();
  },
};
