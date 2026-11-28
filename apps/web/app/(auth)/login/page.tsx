import Link from "next/link";

import { LoginForm } from "@/app/(auth)/login/components/login-form";
import { AuthPage } from "@/components/auth/auth-page";

export default function Login() {
  return (
    <AuthPage
      title="Sign in to llame"
      description="Use your account on this instance."
      footer={
        <>
          Don&apos;t have an account?{" "}
          <Link
            href="/register"
            className="font-medium text-foreground underline underline-offset-4"
          >
            Sign up
          </Link>
        </>
      }
    >
      <LoginForm />
    </AuthPage>
  );
}
