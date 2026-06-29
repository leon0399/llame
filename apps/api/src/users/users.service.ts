import { Inject, Injectable } from '@nestjs/common';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import * as schema from '../db/schema';
import { User, users } from '../db/schema';

// Allowlist, not blocklist: PublicUser enumerates the fields safe to expose. A new
// column on `users` (e.g. a 2FA secret, OAuth/refresh token, API key) is NOT returned
// over HTTP until someone explicitly adds it here — fail closed, never leak by default.
export type PublicUser = Pick<
  User,
  'id' | 'name' | 'email' | 'emailVerified' | 'image'
>;

/** Project a user to the fields safe to cross the HTTP boundary. */
export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    emailVerified: user.emailVerified,
    image: user.image,
  };
}

// NOTE: the methods below return the FULL `User` (incl. `password`) for INTERNAL use
// only — e.g. credential verification when auth lands (#60). Anything returning a user
// over HTTP MUST map through `toPublicUser` first (see UsersController).
@Injectable()
export class UsersService {
  constructor(
    @Inject('DB_DEV') private db: PostgresJsDatabase<typeof schema>,
  ) {}

  async getUserByEmail(email: string): Promise<User | undefined> {
    const user = await this.db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    return user.length ? user[0] : undefined;
  }

  async getUserById(id: string): Promise<User | undefined> {
    const user = await this.db
      .select()
      .from(users)
      .where(eq(users.id, id))
      .limit(1);

    return user.length ? user[0] : undefined;
  }

  async createUser(userData: {
    name?: string;
    email: string;
    password?: string;
    image?: string;
  }): Promise<User> {
    const [newUser] = await this.db.insert(users).values(userData).returning();

    return newUser;
  }
}
