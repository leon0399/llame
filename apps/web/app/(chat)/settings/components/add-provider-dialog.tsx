"use client";

import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { HTTPError } from "ky";
import * as z from "zod";

import { Button } from "@workspace/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@workspace/ui/components/dialog";
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
import { PlusIcon } from "lucide-react";

import {
  useCreateProviderAccount,
  type ProviderType,
} from "@/lib/services/providers/queries";

// The provider types the web form offers today. The api enum is wider
// (anthropic, bedrock, …) but only these two have a working adapter (#82),
// so the UI does not let a user create an account that would fail closed at
// chat time.
const OFFERED_PROVIDERS: { value: ProviderType; label: string }[] = [
  { value: "openrouter", label: "OpenRouter" },
  { value: "openai_compatible", label: "OpenAI-compatible" },
];

const schema = z.object({
  providerType: z.enum(["openrouter", "openai_compatible"]),
  displayName: z.string().min(1, "Give it a name").max(120),
  apiKey: z.string().min(1, "API key is required").max(4096),
  baseUrl: z
    .string()
    .url("Must be a valid URL")
    .optional()
    .or(z.literal("")),
  defaultModel: z.string().max(200).optional(),
});

type FormValues = z.infer<typeof schema>;

export function AddProviderDialog() {
  const [open, setOpen] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const create = useCreateProviderAccount();

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      providerType: "openrouter",
      displayName: "",
      apiKey: "",
      baseUrl: "",
      defaultModel: "",
    },
  });

  const providerType = form.watch("providerType");

  const onSubmit = async (values: FormValues) => {
    setSubmitError(null);
    try {
      await create.mutateAsync({
        providerType: values.providerType,
        displayName: values.displayName,
        apiKey: values.apiKey,
        ...(values.baseUrl ? { baseUrl: values.baseUrl } : {}),
        ...(values.defaultModel ? { defaultModel: values.defaultModel } : {}),
      });
      form.reset();
      setOpen(false);
    } catch (error) {
      // The api returns 400 with a clear message when the vault is disabled
      // (no CREDENTIAL_MASTER_KEYS) — surface it rather than a generic error.
      if (error instanceof HTTPError) {
        const body = (await error.response
          .json()
          .catch(() => null)) as { message?: string | string[] } | null;
        const message = Array.isArray(body?.message)
          ? body?.message.join(", ")
          : body?.message;
        setSubmitError(message ?? "Could not add the provider.");
      } else {
        setSubmitError("Could not add the provider.");
      }
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setSubmitError(null);
          form.reset();
        }
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">
          <PlusIcon className="mr-2 h-4 w-4" />
          Add provider
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a model provider</DialogTitle>
          <DialogDescription>
            Your API key is encrypted on the server and never shown again.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="space-y-4"
            noValidate
          >
            <FormField
              control={form.control}
              name="providerType"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Provider</FormLabel>
                  <FormControl>
                    <select
                      {...field}
                      className="border-input bg-transparent flex h-9 w-full rounded-md border px-3 py-1 text-sm shadow-sm focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-1"
                    >
                      {OFFERED_PROVIDERS.map((p) => (
                        <option key={p.value} value={p.value}>
                          {p.label}
                        </option>
                      ))}
                    </select>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="displayName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input placeholder="My OpenRouter" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="apiKey"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>API key</FormLabel>
                  <FormControl>
                    <Input
                      type="password"
                      autoComplete="off"
                      placeholder="sk-..."
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="defaultModel"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Default model</FormLabel>
                  <FormControl>
                    <Input
                      placeholder={
                        providerType === "openrouter"
                          ? "openai/gpt-5.4-mini"
                          : "gpt-4o-mini"
                      }
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            {providerType === "openai_compatible" ? (
              <FormField
                control={form.control}
                name="baseUrl"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Base URL</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="https://api.groq.com/openai/v1"
                        {...field}
                      />
                    </FormControl>
                    <FormDescription>
                      The OpenAI-compatible endpoint. Leave empty for OpenAI.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            ) : null}
            {submitError ? (
              <p className="text-destructive text-sm">{submitError}</p>
            ) : null}
            <DialogFooter>
              <Button type="submit" disabled={create.isPending}>
                {create.isPending ? "Adding…" : "Add provider"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
