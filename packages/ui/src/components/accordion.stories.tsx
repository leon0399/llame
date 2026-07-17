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
  tags: ["autodocs"],
} satisfies Meta<typeof Accordion>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Demo: Story = {
  args: { type: "single" },
  render: () => (
    <Accordion
      type="single"
      collapsible
      defaultValue="shipping"
      className="max-w-lg"
    >
      <AccordionItem value="shipping">
        <AccordionTrigger>What are your shipping options?</AccordionTrigger>
        <AccordionContent>
          We offer standard (5-7 days), express (2-3 days), and overnight
          shipping. Free shipping on international orders.
        </AccordionContent>
      </AccordionItem>
      <AccordionItem value="returns">
        <AccordionTrigger>What is your return policy?</AccordionTrigger>
        <AccordionContent>
          Returns accepted within 30 days. Items must be unused and in original
          packaging. Refunds processed within 5-7 business days.
        </AccordionContent>
      </AccordionItem>
      <AccordionItem value="support">
        <AccordionTrigger>How can I contact customer support?</AccordionTrigger>
        <AccordionContent>
          Reach us via email, live chat, or phone. We respond within 24 hours
          during business days.
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  ),
  play: async ({ canvas, userEvent }) => {
    const shippingTrigger = canvas.getByRole("button", {
      name: "What are your shipping options?",
    });
    const returnsTrigger = canvas.getByRole("button", {
      name: "What is your return policy?",
    });

    await expect(shippingTrigger).toHaveAttribute("data-state", "open");
    await expect(
      canvas.getByText(/We offer standard \(5-7 days\)/),
    ).toBeVisible();

    await userEvent.click(returnsTrigger);
    await waitFor(() =>
      expect(returnsTrigger).toHaveAttribute("data-state", "open"),
    );
    await expect(
      canvas.getByText(/Returns accepted within 30 days/),
    ).toBeVisible();
    await expect(shippingTrigger).toHaveAttribute("data-state", "closed");
  },
};

const basicItems = [
  {
    value: "item-1",
    trigger: "How do I reset my password?",
    content:
      "Click on 'Forgot Password' on the login page, enter your email address, and we'll send you a link to reset your password. The link will expire in 24 hours.",
  },
  {
    value: "item-2",
    trigger: "Can I change my subscription plan?",
    content:
      "Yes, you can upgrade or downgrade your plan at any time from your account settings. Changes will be reflected in your next billing cycle.",
  },
  {
    value: "item-3",
    trigger: "What payment methods do you accept?",
    content:
      "We accept all major credit cards, PayPal, and bank transfers. All payments are processed securely through our payment partners.",
  },
];

export const Basic: Story = {
  args: { type: "single" },
  render: () => (
    <Accordion
      type="single"
      collapsible
      defaultValue="item-1"
      className="max-w-lg"
    >
      {basicItems.map((item) => (
        <AccordionItem key={item.value} value={item.value}>
          <AccordionTrigger>{item.trigger}</AccordionTrigger>
          <AccordionContent>{item.content}</AccordionContent>
        </AccordionItem>
      ))}
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

export const Multiple: Story = {
  args: { type: "multiple" },
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

export const Disabled: Story = {
  args: { type: "single" },
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

export const Borders: Story = {
  args: { type: "single" },
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

export const InCard: Story = {
  args: { type: "single" },
  name: "Card",
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
