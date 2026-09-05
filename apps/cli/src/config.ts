import { existsSync } from 'node:fs';
import { interpolateStringWithSubstitutions } from '@workspace/config-interpolation';
import { normalizeProtectedValues } from '@workspace/runtime-safety';
import { authority, integer, keys, parseJson, record, text } from './validation';
import { readPrivate, writePrivate } from './private-files';
import { CliError } from './errors';

export interface LocalModel {
  readonly id: string;
  readonly model: string;
  readonly baseUrl: string;
  readonly apiKey?: string;
}

export interface LocalConfig {
  readonly defaultModel?: string;
  readonly models: readonly LocalModel[];
  readonly maxSteps: number;
  readonly maxOutputTokens: number;
  readonly maxContextBytes: number;
  readonly timeoutSeconds: number;
  readonly protectedValues: readonly string[];
}

function parseModel(value: unknown, env: NodeJS.ProcessEnv, secrets: string[]): LocalModel {
  const input = record(value, 'model');
  keys(input, ['id', 'model', 'baseUrl', 'apiKey'], 'model');
  let apiKey: string | undefined;
  if (input.apiKey !== undefined) {
    // Reuse llame's single-pass env/file interpolation, not shell expansion.
    const resolved = interpolateStringWithSubstitutions(text(input.apiKey, 'apiKey'), env);
    apiKey = resolved.value;
    secrets.push(apiKey, ...resolved.substituted);
  }
  return { id: text(input.id, 'model id', 200), model: text(input.model, 'provider model', 200),
    baseUrl: authority(text(input.baseUrl, 'model baseUrl', 2048)), apiKey };
}

export function loadConfig(path: string, env: NodeJS.ProcessEnv): LocalConfig {
  const input = record(existsSync(path) ? parseJson(readPrivate(path)) : { version: 1, models: [] }, 'config');
  keys(input, ['version', 'defaultModel', 'models', 'maxSteps', 'maxOutputTokens', 'maxContextBytes', 'timeoutSeconds'], 'config');
  if (input.version !== 1) throw new CliError('config_version', 'Only CLI config version 1 is supported.');
  if (!Array.isArray(input.models) || input.models.length > 50) {
    throw new CliError('invalid_models', 'models must be an array with at most 50 entries.');
  }
  const secrets: string[] = [];
  const models = input.models.map((model) => parseModel(model, env, secrets));
  if (new Set(models.map((model) => model.id)).size !== models.length) {
    throw new CliError('duplicate_model', 'Model IDs must be unique.');
  }
  const defaultModel = input.defaultModel === undefined ? undefined : text(input.defaultModel, 'defaultModel', 200);
  if (defaultModel && !models.some((model) => model.id === defaultModel)) {
    throw new CliError('unknown_model', 'defaultModel must name a configured model.');
  }
  return { models, defaultModel, protectedValues: normalizeProtectedValues(secrets),
    maxSteps: integer(input.maxSteps ?? 8, 'maxSteps', 1, 32),
    maxOutputTokens: integer(input.maxOutputTokens ?? 4096, 'maxOutputTokens', 64, 65_536),
    maxContextBytes: integer(input.maxContextBytes ?? 100_000, 'maxContextBytes', 4096, 2_000_000),
    timeoutSeconds: integer(input.timeoutSeconds ?? 120, 'timeoutSeconds', 5, 3600) };
}

export function selectModel(config: LocalConfig, id?: string): LocalModel {
  const selected = config.models.find((model) => model.id === (id || config.defaultModel));
  if (!selected) throw new CliError('model_required', 'Configure a model with config init, then select it with --model or defaultModel.');
  return selected;
}

export function initializeConfig(path: string): void {
  writePrivate(path, JSON.stringify({ version: 1, defaultModel: 'local', models: [
    { id: 'local', model: 'CHANGE_TO_YOUR_INSTALLED_MODEL', baseUrl: 'http://127.0.0.1:11434/v1' },
  ], maxSteps: 8, maxOutputTokens: 4096, maxContextBytes: 100_000, timeoutSeconds: 120 }, null, 2) + '\n', false);
}
