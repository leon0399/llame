import { Inject, Injectable } from '@nestjs/common';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import * as schema from '../db/schema';
import { User, users } from '../db/schema';

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
