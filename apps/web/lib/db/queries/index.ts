"use server";

import { eq } from "drizzle-orm";
import { db } from "../db";
import { accounts, chats, User, users } from "../schema";

export const getUserByEmail = async (email: string): Promise<User | undefined> => {
  const user = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  return user.length ? user[0] : undefined;
};

export const getUserById = async (id: string): Promise<User | undefined> => {
  const user = await db
    .select()
    .from(users)
    .where(eq(users.id, id))
    .limit(1);

  return user.length ? user[0] : undefined;
};

export const getAccountByUserId = async (userId: string) => {
  const account = await db
    .select()
    .from(accounts)
    .where(eq(accounts.userId, userId))
    .limit(1);

  return account.length ? account[0] : undefined;
};

export const getChatsByUserId = async (userId: string) => {
  const userChats = await db
    .select()
    .from(chats)
    .where(eq(chats.userId, userId));

  return userChats.length ? userChats : [];
};