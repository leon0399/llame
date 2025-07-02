import { LoginForm } from "@/app/(auth)/login/components/login-form"
import Link from "next/link"

export default function Login() {
  return (
    <div className="w-full max-w-md space-y-4">
      <LoginForm />
      <div className="text-center text-sm">
        Don't have an account?{" "}
        <Link href="/register" className="underline">
          Sign up
        </Link>
      </div>
    </div>
  )
}
