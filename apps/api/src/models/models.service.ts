import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { SecretString } from '../providers/credential-crypto';
import { ProvidersService } from '../providers/providers.service';
import {
  requireModelCredential,
  type ModelClient,
  type ModelCredentialResolver,
} from './model-client';
import { createOpenAIModelClient } from './openai-model-client';

/** A resolved, ready-to-use model credential. The key stays wrapped. */
export type ResolvedModelCredential = {
  apiKey: SecretString;
  baseUrl?: string;
  model?: string;
  source: 'byok' | 'instance';
};

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
