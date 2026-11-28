import Link from "next/link";

import { AuthPage } from "@/components/auth/auth-page";
import { RegisterForm } from "@/components/auth/register-form";

export default function Register() {
  return (
    <AuthPage
      title="Create an account"
      description="An account on this instance, with its own chats and projects."
      footer={
        <>
          Already have an account?{" "}
          <Link
            href="/login"
            className="font-medium text-foreground underline underline-offset-4"
          >
            Sign in
          </Link>
        </>
      }
    >
      <RegisterForm />
    </AuthPage>
  );
}
