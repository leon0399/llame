import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { type ProviderType } from '../db/schema';
import { SecretString } from '../providers/credential-crypto';
import { ProvidersService } from '../providers/providers.service';
import {
  requireModelCredential,
  type ModelClient,
  type ModelCredentialResolver,
} from './model-client';
import { createOpenAIModelClient } from './openai-model-client';
import { createOpenRouterModelClient } from './openrouter-model-client';

/** A resolved, ready-to-use model credential. The key stays wrapped. */
export type ResolvedModelCredential = {
  apiKey: SecretString;
  baseUrl?: string;
  model?: string;
  source: 'byok' | 'instance';
  /** Adapter dispatch (#82). Absent = openai_compatible (the env path). */
  providerType?: ProviderType;
};

/** A provider type the instance has no adapter for — always fail closed. */
export class UnsupportedProviderTypeError extends Error {
  constructor(readonly providerType: string) {
    super(`No adapter for provider type '${providerType}'.`);
    this.name = 'UnsupportedProviderTypeError';
  }
}

@Injectable()
export class ModelsService {
  constructor(
    private readonly config: ConfigService,
    private readonly providers: ProvidersService,
  ) {}

  /**
   * Resolution order (#18, SPEC §14.3): the user's own provider account
   * (BYOK) first, then the instance-wide env key. Throws
   * MissingModelCredentialError (→ 402) when neither exists — the instance
   * boots with no provider at all.
   */
  async resolveModelCredential(
    userId: string,
    resolveCredential?: ModelCredentialResolver,
  ): Promise<ResolvedModelCredential> {
    // Test seam: an explicit resolver bypasses BYOK (legacy contract).
    if (resolveCredential) {
      const key = requireModelCredential(
        await resolveCredential(userId),
        userId,
      );
      return { apiKey: new SecretString(key), source: 'instance' };
    }

    const byok = await this.providers.resolveUserCredential(userId);
    if (byok) {
      return {
        apiKey: byok.apiKey,
        ...(byok.baseUrl !== undefined ? { baseUrl: byok.baseUrl } : {}),
        ...(byok.model !== undefined ? { model: byok.model } : {}),
        source: 'byok',
        providerType: byok.providerType,
      };
    }

    const key = requireModelCredential(
      this.config.get<string>('OPENAI_API_KEY'),
      userId,
    );
    return { apiKey: new SecretString(key), source: 'instance' };
  }

  requireModelCredential(
    credential: string | null | undefined,
    userId?: string,
  ): string {
    return requireModelCredential(credential, userId);
  }

  /**
   * Adapter dispatch (#82): the account's provider type selects the client.
   * openrouter uses the NATIVE @openrouter/ai-sdk-provider path (never the
   * OpenAI-compatible base_url shim); openai_compatible (and the env path)
   * use the OpenAI-compatible client; anything else fails closed.
   */
  createModelClient(credential: ResolvedModelCredential): ModelClient {
    const providerType = credential.providerType ?? 'openai_compatible';
    if (providerType === 'openrouter') {
      return createOpenRouterModelClient(
        credential.apiKey.reveal(),
        credential.model,
      );
    }
    if (providerType === 'openai_compatible') {
      return this.createOpenAIClient(credential);
    }
    throw new UnsupportedProviderTypeError(providerType);
  }

  createOpenAIClient(
    credential: ResolvedModelCredential | string,
    model?: string,
  ): ModelClient {
    const resolved: ResolvedModelCredential =
      typeof credential === 'string'
        ? { apiKey: new SecretString(credential), source: 'instance' }
        : credential;
    // `|| undefined` — .env.example ships these keys empty, and dotenv parses
    // `OPENAI_MODEL=` to '' rather than leaving the variable unset.
    return createOpenAIModelClient(
      resolved.apiKey.reveal(),
      model ??
        resolved.model ??
        (this.config.get<string>('OPENAI_MODEL') || undefined),
      resolved.baseUrl ??
        (this.config.get<string>('OPENAI_BASE_URL') || undefined),
    );
  }
}
