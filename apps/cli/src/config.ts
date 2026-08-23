import { readFileSync } from "node:fs";

import { interpolateString, InterpolationError } from "@workspace/config";
import { isNumber, isRecord, isString } from "@workspace/harness";

export class CliConfigError extends Error {
  readonly code = "cli_config_error";

  constructor(message: string) {
    super(message);
    this.name = "CliConfigError";
  }
}

export interface CliConfig {
  /** Model id sent to the provider (required). */
  readonly model: string;
  /** OpenAI-compatible base URL; absent = the provider default. */
  readonly baseUrl?: string;
  /** API key; absent falls back to a keyless placeholder (local servers). */
  readonly apiKey?: string;
  /** Max tool-requesting steps per run. */
  readonly maxSteps?: number;
}

/**
 * Values that may carry `{env:NAME}` / `{path:LOCATION}` tokens — the same
 * operator secret grammar as `llame.config.json`, resolved through the
 * extracted @workspace/config interpolator. Resolution failures fail loud:
 * a half-configured harness must not boot.
 */
interface InterpolatedField {
  readonly value?: string;
  readonly error?: string;
}

function interpolateField(
  field: string,
  value: string,
  env: NodeJS.ProcessEnv,
): InterpolatedField {
  try {
    return { value: interpolateString(value, env) };
  } catch (error) {
    if (error instanceof InterpolationError) {
      return {
        error: `${field}: ${error.message} (from llame.cli.json)`,
      };
    }
    throw error;
  }
}

function fromJsonFile(configPath: string): Partial<CliConfig> | undefined {
  let raw: string;
  try {
    raw = readFileSync(configPath, "utf8");
  } catch {
    return undefined;
  }
  let parsed: unknown;
  try {
    // SAFETY: the result is validated by isRecord and per-field guards
    // immediately below; malformed content fails loud, never half-reads.
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new CliConfigError(`Config file ${configPath} is not valid JSON.`);
  }
  if (!isRecord(parsed)) {
    throw new CliConfigError(
      `Config file ${configPath} must contain a JSON object.`,
    );
  }
  // SAFETY: every field read below goes through asOptionalString/isNumber
  // guards before use; an unexpected shape fails loud at its own field.
  const record = parsed as {
    model?: unknown;
    baseUrl?: unknown;
    apiKey?: unknown;
    maxSteps?: unknown;
  };
  const asOptionalString = (
    field: string,
    // eslint-disable-next-line anti-slop/no-unknown-parameters -- this helper IS the boundary parse for the named field; isString below is the validation.
    value: unknown,
  ): string | undefined => {
    if (value === undefined) return undefined;
    if (!isString(value)) {
      throw new CliConfigError(`Config field "${field}" must be a string.`);
    }
    return value;
  };
  const model = asOptionalString("model", record.model);
  const baseUrl = asOptionalString("baseUrl", record.baseUrl);
  const apiKey = asOptionalString("apiKey", record.apiKey);
  let maxSteps: number | undefined;
  if (record.maxSteps !== undefined) {
    if (!isNumber(record.maxSteps) || !Number.isInteger(record.maxSteps)) {
      throw new CliConfigError('Config field "maxSteps" must be an integer.');
    }
    maxSteps = record.maxSteps;
  }
  return {
    ...(model !== undefined && { model }),
    ...(baseUrl !== undefined && { baseUrl }),
    ...(apiKey !== undefined && { apiKey }),
    ...(maxSteps !== undefined && { maxSteps }),
  };
}

/**
 * Resolve the CLI's inference configuration. Precedence: `llame.cli.json`
 * in the workspace root, then environment variables. The model id is
 * required — without one there is nothing to run, and guessing is not an
 * option a harness gets to make.
 */
export function loadCliConfig(
  env: NodeJS.ProcessEnv,
  configPath: string,
): CliConfig {
  const file = fromJsonFile(configPath);

  const rawModel = file?.model ?? env.LLAME_MODEL ?? env.OPENAI_MODEL;
  const rawBaseUrl = file?.baseUrl ?? env.LLAME_BASE_URL ?? env.OPENAI_BASE_URL;
  const rawApiKey = file?.apiKey ?? env.LLAME_API_KEY ?? env.OPENAI_API_KEY;

  if (!rawModel || rawModel.trim() === "") {
    throw new CliConfigError(
      "No model configured. Set LLAME_MODEL (or OPENAI_MODEL), or add " +
        '{"model": "..."} to llame.cli.json in the workspace root.',
    );
  }

  const model = interpolateField("model", rawModel, env);
  if (model.error !== undefined) {
    throw new CliConfigError(model.error);
  }
  let baseUrl: string | undefined;
  if (rawBaseUrl !== undefined) {
    const result = interpolateField("baseUrl", rawBaseUrl, env);
    if (result.error !== undefined) {
      throw new CliConfigError(result.error);
    }
    baseUrl = result.value;
  }
  let apiKey: string | undefined;
  if (rawApiKey !== undefined) {
    const result = interpolateField("apiKey", rawApiKey, env);
    if (result.error !== undefined) {
      throw new CliConfigError(result.error);
    }
    apiKey = result.value;
  }

  return {
    model: model.value ?? "",
    ...(baseUrl !== undefined && { baseUrl }),
    ...(apiKey !== undefined && { apiKey }),
    ...(file?.maxSteps !== undefined && { maxSteps: file.maxSteps }),
  };
}
