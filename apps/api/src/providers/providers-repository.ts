/**
 * ProvidersRepository (#18) — provider accounts + encrypted credentials.
 * RLS (FORCE) scopes both; credentials are never more visible than their
 * parent account, and the encrypted payload never leaves apps/api.
 */

import { and, asc, desc, eq } from 'drizzle-orm';
import {
  credentials,
  providerAccounts,
  type Credential,
  type CredentialSecretType,
  type ProviderAccount,
  type ProviderScopeType,
  type ProviderType,
} from '../db/schema';
import { type Db } from '../db/tenant-db.service';

export class ProvidersRepository {
  constructor(private readonly db: Db) {}

  async createAccount(input: {
    ownerScopeType: ProviderScopeType;
    ownerScopeId: string;
    providerType: ProviderType;
    displayName: string;
    baseUrl?: string;
    defaultModel?: string;
  }): Promise<ProviderAccount> {
    const [created] = await this.db
      .insert(providerAccounts)
      .values(input)
      .returning();
    return created;
  }

  async findAccountById(id: string): Promise<ProviderAccount | undefined> {
    const rows = await this.db
      .select()
      .from(providerAccounts)
      .where(eq(providerAccounts.id, id))
      .limit(1);
    return rows[0];
  }

  async listAccountsByScope(
    scopeType: ProviderScopeType,
    scopeId: string,
  ): Promise<ProviderAccount[]> {
    return this.db
      .select()
      .from(providerAccounts)
      .where(
        and(
          eq(providerAccounts.ownerScopeType, scopeType),
          eq(providerAccounts.ownerScopeId, scopeId),
        ),
      )
      .orderBy(asc(providerAccounts.createdAt));
  }

  async setAccountEnabled(
    id: string,
    enabled: boolean,
  ): Promise<ProviderAccount | undefined> {
    const [updated] = await this.db
      .update(providerAccounts)
      .set({ enabled, updatedAt: new Date() })
      .where(eq(providerAccounts.id, id))
      .returning();
    return updated;
  }

  async removeAccount(id: string): Promise<boolean> {
    const removed = await this.db
      .delete(providerAccounts)
      .where(eq(providerAccounts.id, id))
      .returning({ id: providerAccounts.id });
    return removed.length > 0;
  }

  /** Store a sealed secret. One active credential per account for v0.4. */
  async createCredential(input: {
    providerAccountId: string;
    secretType: CredentialSecretType;
    encryptedPayload: string;
    keyVersion: number;
    createdBy: string;
  }): Promise<Credential> {
    const [created] = await this.db
      .insert(credentials)
      .values(input)
      .returning();
    return created;
  }

  /** Newest credential for an account (rotation keeps history). */
  async findLatestCredential(
    providerAccountId: string,
  ): Promise<Credential | undefined> {
    const rows = await this.db
      .select()
      .from(credentials)
      .where(eq(credentials.providerAccountId, providerAccountId))
      .orderBy(desc(credentials.createdAt))
      .limit(1);
    return rows[0];
  }

  async touchCredentialUsed(id: string): Promise<void> {
    await this.db
      .update(credentials)
      .set({ lastUsedAt: new Date() })
      .where(eq(credentials.id, id));
  }
}
