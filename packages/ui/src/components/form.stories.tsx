import { zodResolver } from "@hookform/resolvers/zod";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useForm } from "react-hook-form";
import { expect, screen, waitFor } from "storybook/test";
import { z } from "zod";

import { Button } from "./button.js";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "./form.js";
import { Input } from "./input.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./select.js";

// `form.tsx` has no upstream `apps/v4/examples/radix/form-*.tsx` example
// files (shadcn's Form docs render a single inline demo, not a set of
// per-example files), so every story here is our own composition and the
// file carries the "ai-generated" provenance tag on each story.
// `Form` is react-hook-form's `FormProvider`, whose props are the (required)
// `useForm` return value — every story below is `render`-only, so `Meta<typeof
// Form>`'s `args` would always be unsatisfiable via `satisfies`. Annotate the
// type instead, per packages/ui/AGENTS.md's guidance for generic components.
const meta: Meta<typeof Form> = {
  component: Form,
  subcomponents: {
    FormItem,
    FormLabel,
    FormControl,
    FormDescription,
    FormMessage,
  },
  parameters: {
    layout: "centered",
  },
  decorators: [
    (Story) => (
      <div className="w-[22rem] max-w-full">
        <Story />
      </div>
    ),
  ],
  tags: ["autodocs"],
};

export default meta;

type Story = StoryObj<typeof meta>;

interface BasicValues {
  username: string;
}

/**
 * Use for the standard react-hook-form wiring: `useForm` + `FormField`
 * connect a single control to `FormLabel`/`FormControl`/`FormDescription`/
 * `FormMessage` — no validation rules, so `FormMessage` renders nothing.
 *
 * @summary for the standard single-field Form wiring
 */
export const Basic: Story = {
  tags: ["ai-generated"],
  render: function BasicRender() {
    const form = useForm<BasicValues>({ defaultValues: { username: "" } });

    return (
      <Form {...form}>
        <form
          onSubmit={form.handleSubmit(() => {})}
          className="flex flex-col gap-6"
        >
          <FormField
            control={form.control}
            name="username"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Username</FormLabel>
                <FormControl>
                  <Input placeholder="shadcn" {...field} />
                </FormControl>
                <FormDescription>
                  This is your public display name.
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          <Button type="submit">Submit</Button>
        </form>
      </Form>
    );
  },
};

const validationSchema = z.object({
  username: z.string().min(2, {
    message: "Username must be at least 2 characters.",
  }),
});

type ValidationValues = z.infer<typeof validationSchema>;

/**
 * Use a zod `resolver` to enforce a field's validation rule; the play
 * function submits the empty form and asserts `FormMessage` surfaces the
 * schema's error text.
 *
 * @summary for a zod-validated field surfacing its error on submit
 */
export const Validation: Story = {
  tags: ["ai-generated"],
  render: function ValidationRender() {
    const form = useForm<ValidationValues>({
      resolver: zodResolver(validationSchema),
      defaultValues: { username: "" },
    });

    return (
      <Form {...form}>
        <form
          onSubmit={form.handleSubmit(() => {})}
          className="flex flex-col gap-6"
        >
          <FormField
            control={form.control}
            name="username"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Username</FormLabel>
                <FormControl>
                  <Input placeholder="shadcn" {...field} />
                </FormControl>
                <FormDescription>
                  This is your public display name.
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          <Button type="submit">Submit</Button>
        </form>
      </Form>
    );
  },
  play: async ({ canvas, userEvent }) => {
    await expect(
      canvas.queryByText("Username must be at least 2 characters."),
    ).not.toBeInTheDocument();

    await userEvent.click(canvas.getByRole("button", { name: "Submit" }));

    await waitFor(() =>
      expect(
        canvas.getByText("Username must be at least 2 characters."),
      ).toBeInTheDocument(),
    );
    await expect(canvas.getByPlaceholderText("shadcn")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
  },
};

const preferenceSchema = z.object({
  contactPreference: z.string().min(1, {
    message: "Please select a contact preference.",
  }),
});

type PreferenceValues = z.infer<typeof preferenceSchema>;

// Base UI's Select reads option labels from the Root `items` map to render the
// trigger value; without it the trigger shows the raw value ("email").
const CONTACT_ITEMS = [
  { label: "Email", value: "email" },
  { label: "SMS", value: "sms" },
  { label: "Phone call", value: "phone" },
];

/**
 * Use `field.onChange`/`field.value` (rather than `{...field}`) to wire a
 * controlled component like `Select` — `FormField`'s underlying `Controller`
 * supports both patterns uniformly. The play function selects an option and
 * verifies the trigger reflects it.
 *
 * @summary for wiring a controlled Select through FormField
 */
export const WithSelect: Story = {
  tags: ["ai-generated"],
  // Radix Select portals focus guards outside the story canvas — an
  // implementation-level axe false positive, same as select.stories.tsx.
  parameters: {
    a11y: {
      config: {
        rules: [{ id: "aria-hidden-focus", enabled: false }],
      },
    },
  },
  render: function WithSelectRender() {
    const form = useForm<PreferenceValues>({
      resolver: zodResolver(preferenceSchema),
      defaultValues: { contactPreference: "" },
    });

    return (
      <Form {...form}>
        <form
          onSubmit={form.handleSubmit(() => {})}
          className="flex flex-col gap-6"
        >
          <FormField
            control={form.control}
            name="contactPreference"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Contact preference</FormLabel>
                <Select
                  items={CONTACT_ITEMS}
                  onValueChange={field.onChange}
                  value={field.value}
                >
                  <FormControl>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select how we should reach you" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent aria-label="Contact preference options">
                    <SelectItem value="email">Email</SelectItem>
                    <SelectItem value="sms">SMS</SelectItem>
                    <SelectItem value="phone">Phone call</SelectItem>
                  </SelectContent>
                </Select>
                <FormDescription>
                  We only use this to reach you about your account.
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          <Button type="submit">Submit</Button>
        </form>
      </Form>
    );
  },
  play: async ({ canvas, userEvent }) => {
    const trigger = canvas.getByRole("combobox", {
      name: "Contact preference",
    });

    await userEvent.click(trigger);
    // Base UI's select listbox is portalled in only while open, so its
    // presence is the open signal (it carries no Radix `data-state`).
    const listbox = await screen.findByRole("listbox");
    await waitFor(() => expect(listbox).toBeInTheDocument());
    await userEvent.click(screen.getByRole("option", { name: "Email" }));
    await expect(trigger).toHaveTextContent("Email");
  },
};
