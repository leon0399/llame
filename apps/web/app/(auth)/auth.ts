import NextAuth from "next-auth"

import { authConfig } from "./auth.config"
import { DrizzleAdapter } from "@auth/drizzle-adapter"
import { db } from "@/lib/db"
import {
    users,
    accounts,
    sessions,
    verificationTokens,
} from "@/lib/db/schema/auth"
import Passkey from "next-auth/providers/passkey"

export const { handlers, signIn, signOut, auth } = NextAuth({
    adapter: DrizzleAdapter(db, {
        usersTable: users,
        accountsTable: accounts,
        sessionsTable: sessions,
        verificationTokensTable: verificationTokens,
    }),
    ...authConfig,
    providers: [Passkey],
    experimental: { enableWebAuthn: true },
})
