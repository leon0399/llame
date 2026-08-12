import * as React from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@workspace/ui/components/button";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@workspace/ui/components/form";
import { Input } from "@workspace/ui/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select";
import * as S from "@ds-stories/packages/ui/src/components/form.stories";

function compose(S: any, key: string) {
  const meta: any = S.default ?? {};
  const st: any = S[key];
  const args: any = { ...(meta.args ?? {}), ...(st && st.args ? st.args : {}) };
  // Storybook resolves argTypes.mapping (control value -> real arg) before
  // rendering; mirror that so mapped args don't render raw.
  const at: any = {
    ...(meta.argTypes ?? {}),
    ...(st && st.argTypes ? st.argTypes : {}),
  };
  for (const k of Object.keys(args)) {
    const m = at[k] && at[k].mapping;
    if (m && typeof m === "object" && args[k] in m) args[k] = m[args[k]];
  }
  const title: string = typeof meta.title === "string" ? meta.title : "";
  const ctx: any = {
    args,
    name: key,
    title,
    kind: title,
    id: "",
    componentId: "",
    globals: {},
    viewMode: "story",
    parameters: (st && st.parameters) ?? meta.parameters ?? {},
  };
  let render: (() => any) | null = null;
  if (st && typeof st.render === "function")
    render = () => st.render(args, ctx);
  else if (typeof st === "function") render = () => st(args, ctx);
  else if (typeof meta.render === "function")
    render = () => meta.render(args, ctx);
  else {
    const C = (st && st.component) || meta.component;
    if (C) render = () => React.createElement(C, args);
  }
  if (!render) return () => null;
  // [].concat: a single function is legal CSF decorator shorthand. A
  // decorator returning undefined (stubbed addon) falls through to the inner
  // render — otherwise one unrecognized addon blanks the cell silently.
  const decorators: any[] = ([] as any[])
    .concat((st && st.decorators) ?? [])
    .concat(meta.decorators ?? []);
  return decorators.reduce(
    (inner: any, dec: any) => () => {
      const out = dec(inner, ctx);
      return out === undefined ? inner() : out;
    },
    render,
  );
}

export const Basic = /* Basic */ compose(S, "Basic");

const validationSchema = z.object({
  username: z.string().min(2, {
    message: "Username must be at least 2 characters.",
  }),
});

type ValidationValues = z.infer<typeof validationSchema>;

// Validation's play submits the empty form to surface react-hook-form's zod
// error (the interaction-driven-content limitation documented in
// .ds-sync/storybook/SKILL.md §4a — compiled previews never run play).
// react-hook-form's `useForm` accepts a declarative `errors` option
// (verified in the installed 7.59.0's `UseFormProps` type) that merges
// externally-supplied errors into `formState.errors` via a mount-time
// `useEffect` — the same real path `FormMessage`/`aria-invalid` already read,
// and it also fires `_focusError()` (shouldFocusError defaults true), which
// is exactly what a failed real submit does too. So seeding it with the
// post-play end error is a declarative initial-state prop, the same class of
// fix as `defaultChecked`/`defaultValue` elsewhere — not driving react-hook-form
// imperatively.
export const Validation = function ValidationRender() {
  const form = useForm<ValidationValues>({
    resolver: zodResolver(validationSchema),
    defaultValues: { username: "" },
    errors: {
      username: {
        type: "too_small",
        message: "Username must be at least 2 characters.",
      },
    },
  });

  return (
    <div className="w-[22rem] max-w-full">
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
    </div>
  );
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

// With Select's play opens the Base UI Select and picks "Email" (the
// interaction-driven-content limitation documented in
// .ds-sync/storybook/SKILL.md §4a — compiled previews never run play). Unlike
// Validation above, the end state here IS a declarative initial-state prop:
// the Select's value is controlled by react-hook-form's `field.value`, which
// comes straight from `useForm`'s `defaultValues` — so seeding
// `contactPreference: "email"` (the post-play end value) reproduces the
// storybook reference exactly, the same class of fix as `defaultChecked`/
// `defaultValue` elsewhere, not "driving" react-hook-form.
export const WithSelect = function WithSelectRender() {
  const form = useForm<PreferenceValues>({
    resolver: zodResolver(preferenceSchema),
    defaultValues: { contactPreference: "email" },
  });

  return (
    <div className="w-[22rem] max-w-full">
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
    </div>
  );
};
