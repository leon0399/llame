"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import * as z from "zod";

import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@workspace/ui/components/form";
import { authQueryKeys, register } from "@/lib/services/auth/queries";
import { useQueryClient } from "@tanstack/react-query";

const registerSchema = z
  .object({
    name: z.string().min(2, "Name must be at least 2 characters"),
    email: z.string().email("Invalid email address"),
    password: z.string().min(8, "Password must be at least 8 characters"),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
  });

type RegisterFormValues = z.infer<typeof registerSchema>;

/** The submit flow's state and side effects (session cache seed, redirect,
 *  error mapping) — kept out of `RegisterForm` so it composes only markup. */
function useRegisterSubmit(
  form: ReturnType<typeof useForm<RegisterFormValues>>,
) {
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();
  const queryClient = useQueryClient();

  async function onSubmit(data: RegisterFormValues) {
    setIsLoading(true);

    try {
      const result = await register({
        name: data.name,
        email: data.email,
        password: data.password,
      });

      // Seed the cache from the authoritative register response; no invalidate
      // (useMe is staleTime:0 + refetchOnMount:'always', so "/" refetches on mount).
      queryClient.setQueryData(authQueryKeys.me, result.user);
      router.push("/");
    } catch {
      form.setError("root", {
        message: "Registration failed",
      });
    } finally {
      setIsLoading(false);
    }
  }

  return { isLoading, onSubmit };
}

type RegisterControl = ReturnType<
  typeof useForm<RegisterFormValues>
>["control"];

function NameField({ control }: { control: RegisterControl }) {
  return (
    <FormField
      control={control}
      name="name"
      render={({ field }) => (
        <FormItem>
          <FormLabel>Name</FormLabel>
          <FormControl>
            <Input placeholder="John Doe" {...field} />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

function EmailField({ control }: { control: RegisterControl }) {
  return (
    <FormField
      control={control}
      name="email"
      render={({ field }) => (
        <FormItem>
          <FormLabel>Email</FormLabel>
          <FormControl>
            <Input type="email" placeholder="johndoe@gmail.com" {...field} />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

function PasswordField({ control }: { control: RegisterControl }) {
  return (
    <FormField
      control={control}
      name="password"
      render={({ field }) => (
        <FormItem>
          <FormLabel>Password</FormLabel>
          <FormControl>
            <Input type="password" placeholder="********" {...field} />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

function ConfirmPasswordField({ control }: { control: RegisterControl }) {
  return (
    <FormField
      control={control}
      name="confirmPassword"
      render={({ field }) => (
        <FormItem>
          <FormLabel>Confirm Password</FormLabel>
          <FormControl>
            <Input type="password" placeholder="********" {...field} />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

/** The form's actual field set — kept separate from the `Card` chrome around
 *  it in `RegisterForm`, so each stays a legible, single-purpose piece. */
function RegisterFormFields({
  form,
  isLoading,
  onSubmit,
}: {
  form: ReturnType<typeof useForm<RegisterFormValues>>;
  isLoading: boolean;
  onSubmit: (data: RegisterFormValues) => void;
}) {
  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <NameField control={form.control} />
        <EmailField control={form.control} />
        <PasswordField control={form.control} />
        <ConfirmPasswordField control={form.control} />
        {form.formState.errors.root && (
          <div className="text-sm text-destructive">
            {form.formState.errors.root.message}
          </div>
        )}
        <Button type="submit" className="w-full" disabled={isLoading}>
          {isLoading ? "Creating account..." : "Create account"}
        </Button>
      </form>
    </Form>
  );
}

export function RegisterForm() {
  const form = useForm<RegisterFormValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      name: "",
      email: "",
      password: "",
      confirmPassword: "",
    },
  });
  const { isLoading, onSubmit } = useRegisterSubmit(form);

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle className="text-2xl">Create an account</CardTitle>
        <CardDescription>
          Enter your information to create an account
        </CardDescription>
      </CardHeader>
      <CardContent>
        <RegisterFormFields
          form={form}
          isLoading={isLoading}
          onSubmit={onSubmit}
        />
      </CardContent>
    </Card>
  );
}
