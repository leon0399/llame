import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { TenantDbService } from '../db/tenant-db.service';
import { type ProviderAccount, type ProviderType } from '../db/schema';
import {
  decryptCredential,
  encryptCredential,
  parseMasterKeyRing,
  SecretString,
  type MasterKeyRing,
} from './credential-crypto';
import { ProvidersRepository } from './providers-repository';

/** A decrypted, ready-to-use provider credential. Secret stays wrapped. */
export type ResolvedProviderCredential = {
  apiKey: SecretString;
  baseUrl?: string;
  model?: string;
  source: 'byok' | 'instance';
  providerAccountId?: string;
};

/**
 * ProvidersService (#18, SPEC §14.1–§14.3): BYOK provider accounts with
 * envelope-encrypted secrets. The vault is optional — without
 * CREDENTIAL_MASTER_KEYS the instance boots and instance-env resolution
 * still works; BYOK writes fail closed with a clear message.
 */
@Injectable()
export class ProvidersService {
  private readonly logger = new Logger(ProvidersService.name);
  private readonly ring: MasterKeyRing | null;

  constructor(
    private readonly tenantDb: TenantDbService,
    private readonly config: ConfigService,
  ) {
    this.ring = parseMasterKeyRing(
      this.config.get<string>('CREDENTIAL_MASTER_KEYS'),
    );
  }

  private requireRing(): MasterKeyRing {
    if (!this.ring) {
      throw new BadRequestException(
        'BYOK is not enabled on this instance: set CREDENTIAL_MASTER_KEYS (generate with `openssl rand -base64 32`).',
      );
    }
    return this.ring;
  }

  /** Create a user-scope provider account with its API-key credential. */
  async createUserAccount(input: {
    userId: string;
    providerType: ProviderType;
    displayName: string;
    apiKey: SecretString;
    baseUrl?: string;
    defaultModel?: string;
  }): Promise<ProviderAccount> {
    const ring = this.requireRing();
    return this.tenantDb.runAs(input.userId, async (tx) => {
      const repo = new ProvidersRepository(tx);
      const account = await repo.createAccount({
        ownerScopeType: 'user',
        ownerScopeId: input.userId,
        providerType: input.providerType,
        displayName: input.displayName,
        ...(input.baseUrl !== undefined ? { baseUrl: input.baseUrl } : {}),
        ...(input.defaultModel !== undefined
          ? { defaultModel: input.defaultModel }
          : {}),
      });
      const sealed = encryptCredential({
        ring,
        providerAccountId: account.id,
        secretType: 'api_key',
        secret: input.apiKey,
      });
      await repo.createCredential({
        providerAccountId: account.id,
        secretType: 'api_key',
        encryptedPayload: sealed.encryptedPayload,
        keyVersion: sealed.keyVersion,
        createdBy: input.userId,
      });
      return account;
    });
  }

  async listUserAccounts(userId: string): Promise<ProviderAccount[]> {
    return this.tenantDb.runAs(userId, (tx) =>
      new ProvidersRepository(tx).listAccountsByScope('user', userId),
    );
  }

  async removeUserAccount(userId: string, id: string): Promise<void> {
    const removed = await this.tenantDb.runAs(userId, (tx) =>
      new ProvidersRepository(tx).removeAccount(id),
    );
    if (!removed) {
      throw new NotFoundException(`Provider account ${id} not found`);
    }
  }

  /**
   * BYOK resolution (#18): the user's first enabled account with a live
   * credential, or null when the user has none (the caller falls back to the
   * instance env key). Order: creation order — the router (#37) replaces this
   * with preference/policy-driven selection. Failures inside one account
   * (missing key version, tampered payload) fail CLOSED for that account and
   * are logged, never silently swallowed into "use another random key".
   */
  async resolveUserCredential(
    userId: string,
  ): Promise<ResolvedProviderCredential | null> {
    if (!this.ring) {
      return null;
    }
    const ring = this.ring;
    return this.tenantDb.runAs(userId, async (tx) => {
      const repo = new ProvidersRepository(tx);
      const accounts = await repo.listAccountsByScope('user', userId);
      const account = accounts.find((a) => a.enabled);
      if (!account) {
        return null;
      }
      const credential = await repo.findLatestCredential(account.id);
      if (!credential) {
        this.logger.warn(
          `Provider account ${account.id} has no credential; skipping BYOK`,
        );
        return null;
      }
      if (credential.expiresAt && credential.expiresAt <= new Date()) {
        this.logger.warn(
          `Credential ${credential.id} expired; failing closed for account ${account.id}`,
        );
        return null;
      }
      const apiKey = decryptCredential({
        ring,
        providerAccountId: account.id,
        secretType: credential.secretType,
        encryptedPayload: credential.encryptedPayload,
        keyVersion: credential.keyVersion,
      });
      await repo.touchCredentialUsed(credential.id);
      return {
        apiKey,
        ...(account.baseUrl ? { baseUrl: account.baseUrl } : {}),
        ...(account.defaultModel ? { model: account.defaultModel } : {}),
        source: 'byok' as const,
        providerAccountId: account.id,
      };
    });
  }
}
