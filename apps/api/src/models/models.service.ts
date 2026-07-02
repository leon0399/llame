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
import {
  createOpenAIModelClient,
  DEFAULT_OPENAI_MODEL,
} from './openai-model-client';
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

/** The caller selected a model that isn't in their available set (#76). */
export class ModelNotAvailableError extends Error {
  readonly code = 'model_not_available';

  constructor(readonly modelId: string) {
    super(`Model '${modelId}' is not available to you.`);
    this.name = 'ModelNotAvailableError';
  }
}

/** A model the caller may select (#76). */
export type AvailableModel = {
  id: string;
  label: string;
  providerType: string;
  source: 'byok' | 'instance';
  /** Null for the instance-env model. */
  providerAccountId: string | null;
};

/** The synthetic id of the instance-env model in the available set. */
const INSTANCE_MODEL_SOURCE = 'instance';

@Injectable()
export class ModelsService {
  constructor(
    private readonly config: ConfigService,
    private readonly providers: ProvidersService,
  ) {}

  /** The instance-env model, if an instance key is configured (#76). */
  private instanceModel(): AvailableModel | null {
    const key = this.config.get<string>('OPENAI_API_KEY')?.trim();
    if (!key) {
      return null;
    }
    const id =
      this.config.get<string>('OPENAI_MODEL')?.trim() || DEFAULT_OPENAI_MODEL;
    return {
      id,
      label: id,
      providerType: 'openai_compatible',
      source: INSTANCE_MODEL_SOURCE,
      providerAccountId: null,
    };
  }

  /**
   * The models available to the caller (#76): each enabled provider account's
   * default model, plus the instance-env model when configured. The chat
   * selector shows exactly this set; selecting anything else is rejected
   * before provider invocation. Deduped by id — a BYOK model wins over the
   * instance model of the same id (the user's own credit).
   */
  async listAvailableModels(userId: string): Promise<AvailableModel[]> {
    const providerModels = await this.providers.listAvailableModels(userId);
    const models: AvailableModel[] = providerModels.map((m) => ({
      id: m.id,
      label: `${m.displayName} · ${m.id}`,
      providerType: m.providerType,
      source: 'byok',
      providerAccountId: m.providerAccountId,
    }));

    const instance = this.instanceModel();
    if (instance && !models.some((m) => m.id === instance.id)) {
      models.push(instance);
    }
    return models;
  }

  /**
   * Resolve the credential for a SELECTED model (#76), validating the model is
   * in the caller's available set BEFORE any provider invocation. A null/
   * undefined modelId falls back to default resolution (first account / env).
   * An unknown or unauthorized id throws ModelNotAvailableError — fail closed.
   */
  async resolveForModel(
    userId: string,
    modelId?: string | null,
  ): Promise<ResolvedModelCredential> {
    if (!modelId) {
      return this.resolveModelCredential(userId);
    }

    const available = await this.listAvailableModels(userId);
    const selected = available.find((m) => m.id === modelId);
    if (!selected) {
      throw new ModelNotAvailableError(modelId);
    }

    if (selected.source === 'instance') {
      const key = requireModelCredential(
        this.config.get<string>('OPENAI_API_KEY'),
        userId,
      );
      return {
        apiKey: new SecretString(key),
        source: 'instance',
        model: selected.id,
      };
    }

    const credential = await this.providers.resolveCredentialForAccount(
      userId,
      selected.providerAccountId!,
    );
    if (!credential) {
      // The account vanished/disabled between listing and resolving — the
      // model is no longer available. Fail closed rather than silently using
      // a different account.
      throw new ModelNotAvailableError(modelId);
    }
    return {
      apiKey: credential.apiKey,
      ...(credential.baseUrl !== undefined
        ? { baseUrl: credential.baseUrl }
        : {}),
      model: selected.id,
      source: 'byok',
      providerType: credential.providerType,
    };
  }

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
