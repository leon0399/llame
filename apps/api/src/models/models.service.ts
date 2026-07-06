import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { ConfigResolverService } from '../config-resolver/config-resolver.service';
import { snapshotModelAllowlist } from '../config-resolver/effective-config';
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

/**
 * Filter models to the allowlist (#85). `undefined` allowlist → unchanged (no
 * restriction); a set allowlist → only ids in it (exact match on the LIVE id
 * `listAvailableModels` emits), order preserved. The single enforcement point for
 * both the list and — via resolveForModel → listAvailableModels — the send path.
 */
export function applyModelAllowlist<T extends { id: string }>(
  models: T[],
  allowlist: string[] | undefined,
): T[] {
  if (!allowlist) return models;
  const allowed = new Set(allowlist);
  return models.filter((m) => allowed.has(m.id));
}

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
    private readonly configResolver: ConfigResolverService,
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

    // Model visibility allowlist (#85): filter to the caller's effective
    // allowlist. This is the single choke point — resolveForModel validates a
    // selected id against this same list, so a disallowed model fails closed on
    // the send path too (never silently used).
    const snapshot = await this.configResolver.resolveForUser(userId);
    return applyModelAllowlist(models, snapshotModelAllowlist(snapshot));
  }

  /**
   * Resolve the credential for a SELECTED model (#76), validating the model is
   * in the caller's available set BEFORE any provider invocation. A null/
   * undefined modelId falls back to default resolution. An unknown or
   * unauthorized id throws ModelNotAvailableError — fail closed.
   */
  async resolveForModel(
    userId: string,
    modelId?: string | null,
  ): Promise<ResolvedModelCredential> {
    if (!modelId) {
      // No explicit id → default resolution. When a model ALLOWLIST (#85) is in
      // effect it must apply here too — otherwise omitting `model` (the DTO
      // allows it; the worker passes it through) would bypass the allowlist and
      // defeat the whole control. With no allowlist, keep the existing default.
      const allowlist = snapshotModelAllowlist(
        await this.configResolver.resolveForUser(userId),
      );
      if (!allowlist) {
        return this.resolveModelCredential(userId);
      }
      const [first] = await this.listAvailableModels(userId); // allowlist-filtered
      if (!first) {
        throw new ModelNotAvailableError('(no allowlisted model available)');
      }
      return this.resolveForModel(userId, first.id);
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
