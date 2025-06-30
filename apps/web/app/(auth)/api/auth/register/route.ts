import { NextRequest, NextResponse } from "next/server"
import { hash } from "bcrypt-ts"
import { db } from "@/lib/db"
import { users } from "@/lib/db/schema/auth"
import { eq } from "drizzle-orm"

export async function POST(request: NextRequest) {
  try {
    const json = await request.json()
    const name = json.name as string | undefined
    const email = json.email as string | undefined
    const password = json.password as string | undefined

    if (!name || !email || !password) {
      return new NextResponse("Missing required fields", { status: 400 })
    }

    if (password.length < 8) {
      return new NextResponse("Password must be at least 8 characters", { status: 400 })
    }

    // Check if user already exists
    const existingUser = await db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1)

    if (existingUser.length > 0) {
      return new NextResponse("User already exists", { status: 400 })
    }

    // Hash password
    const hashedPassword = await hash(password, 12)

    // Create user
    await db.insert(users).values({
      name,
      email,
      password: hashedPassword,
    })

    return new NextResponse("User created successfully", { status: 201 })
  } catch (error) {
    console.error("Registration error:", error)
    return new NextResponse("Internal server error", { status: 500 })
  }
}