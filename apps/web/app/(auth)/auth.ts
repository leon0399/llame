import NextAuth from "next-auth"
import { compare } from "bcrypt-ts"
import { eq } from "drizzle-orm"

import { authConfig } from "./auth.config"
import { DrizzleAdapter } from "@auth/drizzle-adapter"
import { db } from "@/lib/db"
import {
    users as usersTable,
    accounts as accountsTable,
    sessions as sessionsTable,
    verificationTokens as verificationTokensTable,
    authenticators as authenticatorsTable
} from "@/lib/db/schema/auth"

import Credentials from "next-auth/providers/credentials"

export const { handlers, signIn, signOut, auth } = NextAuth({
    adapter: DrizzleAdapter(db, {
        usersTable,
        accountsTable,
        sessionsTable,
        verificationTokensTable,
        authenticatorsTable,
    }),
    ...authConfig,
    providers: [
        Credentials({
            credentials: {
                email: {
                    type: "email",
                    label: "Email",
                    placeholder: "johndoe@gmail.com",
                },
                password: {
                    type: "password",
                    label: "Password",
                    placeholder: "*****",
                },
            },
            async authorize(credentials) {
                if (!credentials?.email || !credentials?.password) {
                    return null
                }

                try {
                    // Find user by email
                    const user = await db
                        .select()
                        .from(usersTable)
                        .where(eq(usersTable.email, credentials.email as string))
                        .limit(1)

                    if (!user.length || !user[0].password) {
                        return null
                    }

                    // Verify password
                    const isPasswordValid = await compare(
                        credentials.password as string,
                        user[0].password
                    )

                    if (!isPasswordValid) {
                        return null
                    }

                    // Return user without password
                    const { password, ...userWithoutPassword } = user[0]
                    return userWithoutPassword
                } catch (error) {
                    console.error("Authentication error:", error)
                    return null
                }
            },
        })
    ],
})
