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

// `Basic` is transcribed verbatim from the shadcn Accordion docs' lead demo
// (https://ui.shadcn.com/docs/components/radix/accordion), so the file
// carries the "shadcn-example" provenance tag at the meta level. That demo
// has no docs-page heading/anchor of its own — it sits above "## Installation"
// as the page's introductory preview — so its story JSDoc links the base
// docs page without a fragment. The page's five in-page examples (Basic,
// Multiple, Disabled, Borders, Card) now preview exclusively through
// shadcn's newer "radix-nova" style registry and no longer have a source
// file under `apps/v4/registry/new-york-v4/examples/` (404 as of this
// writing) — per packages/ui/AGENTS.md we don't substitute the incompatible
// registry's version, so we skip transcribing them and instead keep our own
// coverage (Multiple, Disabled, Borders, Card below) tagged "ai-generated".
// RTL is skipped by convention regardless.
const meta = {
  component: Accordion,
  subcomponents: {
    AccordionContent,
    AccordionItem,
    AccordionTrigger,
  },
  parameters: {
    layout: "padded",
  },
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
 * Verbatim from the [shadcn Accordion demo](https://ui.shadcn.com/docs/components/radix/accordion).
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
    <Accordion
      type="single"
      collapsible
      className="w-full"
      defaultValue="item-1"
    >
      <AccordionItem value="item-1">
        <AccordionTrigger>Product Information</AccordionTrigger>
        <AccordionContent className="flex flex-col gap-4 text-balance">
          <p>
            Our flagship product combines cutting-edge technology with sleek
            design. Built with premium materials, it offers unparalleled
            performance and reliability.
          </p>
          <p>
            Key features include advanced processing capabilities, and an
            intuitive user interface designed for both beginners and experts.
          </p>
        </AccordionContent>
      </AccordionItem>
      <AccordionItem value="item-2">
        <AccordionTrigger>Shipping Details</AccordionTrigger>
        <AccordionContent className="flex flex-col gap-4 text-balance">
          <p>
            We offer worldwide shipping through trusted courier partners.
            Standard delivery takes 3-5 business days, while express shipping
            ensures delivery within 1-2 business days.
          </p>
          <p>
            All orders are carefully packaged and fully insured. Track your
            shipment in real-time through our dedicated tracking portal.
          </p>
        </AccordionContent>
      </AccordionItem>
      <AccordionItem value="item-3">
        <AccordionTrigger>Return Policy</AccordionTrigger>
        <AccordionContent className="flex flex-col gap-4 text-balance">
          <p>
            We stand behind our products with a comprehensive 30-day return
            policy. If you&apos;re not completely satisfied, simply return the
            item in its original condition.
          </p>
          <p>
            Our hassle-free return process includes free return shipping and
            full refunds processed within 48 hours of receiving the returned
            item.
          </p>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  ),
  play: async ({ canvas, userEvent }) => {
    const firstTrigger = canvas.getByRole("button", {
      name: "Product Information",
    });
    const secondTrigger = canvas.getByRole("button", {
      name: "Shipping Details",
    });

    await expect(firstTrigger).toHaveAttribute("data-state", "open");
    await userEvent.click(secondTrigger);
    await waitFor(() =>
      expect(secondTrigger).toHaveAttribute("data-state", "open"),
    );
    await expect(
      canvas.getByText(/We offer worldwide shipping through trusted courier/),
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
 * close independently. Upstream's "Multiple" example now only exists in the
 * incompatible radix-nova registry (see the file-level comment), so this
 * remains our own coverage rather than a transcription.
 *
 * @summary for independently open sections
 */
export const Multiple: Story = {
  tags: ["ai-generated", "!shadcn-example"],
  args: { type: "multiple" },
  // See the `type` note on `Basic` — fixed per story, not wired via args.
  argTypes: { type: { control: false } },
  render: () => (
    <Accordion
      type="multiple"
      className="max-w-lg"
      defaultValue={["notifications"]}
    >
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
 * list but non-interactive (e.g. plan-gated features). Upstream's
 * "Disabled" example now only exists in the incompatible radix-nova registry
 * (see the file-level comment), so this remains our own coverage rather than
 * a transcription.
 *
 * @summary for gating individual items
 */
export const Disabled: Story = {
  tags: ["ai-generated", "!shadcn-example"],
  args: { type: "single" },
  // See the `type` note on `Basic` — fixed per story, not wired via args.
  argTypes: { type: { control: false } },
  render: () => (
    <Accordion type="single" collapsible className="w-full">
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
 * and needs its own visual container. Upstream's "Borders" example now only
 * exists in the incompatible radix-nova registry (see the file-level
 * comment), so this remains our own coverage rather than a transcription.
 *
 * @summary for a self-contained bordered accordion
 */
export const Borders: Story = {
  tags: ["ai-generated", "!shadcn-example"],
  args: { type: "single" },
  // See the `type` note on `Basic` — fixed per story, not wired via args.
  argTypes: { type: { control: false } },
  render: () => (
    <Accordion
      type="single"
      collapsible
      className="max-w-lg rounded-lg border"
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
 * surface; the Card supplies the heading and padding. Upstream's "Card"
 * example now only exists in the incompatible radix-nova registry (see the
 * file-level comment), so this remains our own coverage rather than a
 * transcription.
 *
 * @summary for composing an accordion inside a Card
 */
export const InCard: Story = {
  tags: ["ai-generated", "!shadcn-example"],
  args: { type: "single" },
  name: "Card",
  // See the `type` note on `Basic` — fixed per story, not wired via args.
  argTypes: { type: { control: false } },
  render: () => (
    <Card className="w-full max-w-sm">
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
