"use client";

import { useState } from "react";
import type { Route } from "next";
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

import { login, authQueryKeys } from "@/lib/services/auth/queries";
import { useQueryClient } from "@tanstack/react-query";
import { HTTPError } from "ky";

const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
});

type LoginFormValues = z.infer<typeof loginSchema>;

// Only allow same-origin relative paths as a post-login destination. Reject
// absolute URLs and protocol-relative / backslash tricks ("//evil.com",
// "/\\evil.com") so an attacker-supplied ?callbackUrl= can't open-redirect.
// (NextAuth used to validate this; that guard is gone after the cutover.)
// The Route assertion is this guard's contract: whatever passes the checks is
// a same-origin internal path, which is exactly what typedRoutes wants proven.
function safeInternalPath(raw: string | null): Route {
  if (
    !raw ||
    !raw.startsWith("/") ||
    raw.startsWith("//") ||
    raw.startsWith("/\\")
  ) {
    return "/";
  }
  return raw as Route;
}

export function LoginForm() {
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();
  const queryClient = useQueryClient();

  const form = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: "",
      password: "",
    },
  });

  async function onSubmit(data: LoginFormValues) {
    setIsLoading(true);

    try {
      const result = await login({
        email: data.email,
        password: data.password,
      });

      // The login response is the authoritative user; seed the cache. No
      // invalidate needed — useMe is staleTime:0 + refetchOnMount:'always', so
      // the destination remounts and refetches anyway (and invalidating here can
      // race the Set-Cookie commit).
      queryClient.setQueryData(authQueryKeys.me, result.user);
      const callbackUrl = new URLSearchParams(window.location.search).get(
        "callbackUrl",
      );
      router.push(safeInternalPath(callbackUrl));
    } catch (error) {
      // A 401 is genuinely bad credentials; anything else (network, 5xx,
      // misconfig) must not be mislabeled as a wrong password.
      const isInvalidCredentials =
        error instanceof HTTPError && error.response.status === 401;
      form.setError("root", {
        message: isInvalidCredentials
          ? "Invalid email or password"
          : "Something went wrong. Please try again.",
      });
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle className="text-2xl">Login</CardTitle>
        <CardDescription>
          Enter your email below to login to your account
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl>
                    <Input
                      type="email"
                      placeholder="johndoe@gmail.com"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Password</FormLabel>
                  <FormControl>
                    <Input type="password" placeholder="*****" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            {form.formState.errors.root && (
              <div className="text-sm text-destructive">
                {form.formState.errors.root.message}
              </div>
            )}
            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? "Signing in..." : "Sign In"}
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
