import { RegisterForm } from "@/components/auth/register-form";
import Link from "next/link";

export default function Register() {
  return (
    <div className="w-full max-w-sm space-y-4">
      <RegisterForm />
      <div className="text-center text-sm">
        Already have an account?{" "}
        <Link href="/login" className="underline">
          Sign in
        </Link>
      </div>
    </div>
  );
}
