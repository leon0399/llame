import type { NextAuthConfig } from 'next-auth';

import { DrizzleAdapter } from "@auth/drizzle-adapter"
import { db } from "@/lib/db"
import {
  users as usersTable,
  accounts as accountsTable,
  sessions as sessionsTable,
  verificationTokens as verificationTokensTable,
  authenticators as authenticatorsTable
} from "@/lib/db/schema/auth"

export const authConfig = {
  adapter: DrizzleAdapter(db, {
    usersTable,
    accountsTable,
    sessionsTable,
    verificationTokensTable,
    authenticatorsTable,
  }),
  pages: {
    signIn: '/login',
    newUser: '/register',
  },
  providers: [
    // added later in auth.ts since it requires bcrypt which is only compatible with Node.js
    // while this file is also used in non-Node.js environments
  ],
} satisfies NextAuthConfig;
