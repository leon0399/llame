import type {
  FinishReason,
  FlexibleSchema,
  LanguageModelUsage,
  ModelMessage,
  StreamTextOnErrorCallback,
  streamText,
} from 'ai';

export interface ModelStreamInput {
  messages: ModelMessage[];
  system?: string;
  abortSignal?: AbortSignal;
  onError?: StreamTextOnErrorCallback;
  onFinish?: (event: {
    text: string;
    usage: LanguageModelUsage;
    finishReason: FinishReason;
  }) => void | Promise<void>;
}

export interface ModelObjectInput<OBJECT> {
  messages: ModelMessage[];
  system?: string;
  /**
   * Typed schema handle (the AI SDK's jsonSchema<T>() / zodSchema()): carries
   * both the JSON Schema sent to the provider and the TS type it produces, so
   * the result is typed end-to-end with no casts at the call site.
   */
  schema: FlexibleSchema<OBJECT>;
  /**
   * Tool/schema identity forwarded to the provider (function name and
   * description on backends that route structured output through tool calling).
   */
  schemaName?: string;
  schemaDescription?: string;
}

export interface ModelClient {
  readonly model: string;
  readonly provider: string;
  streamText(input: ModelStreamInput): ReturnType<typeof streamText>;
  /**
   * Schema-constrained single object generation via an API-level REQUIRED tool
   * call (toolChoice pinned to the schema's tool). Optional: not every
   * OpenAI-compatible endpoint supports tool calling, and fakes may omit it —
   * callers must keep a plain-text fallback.
   */
  generateObject?<OBJECT>(input: ModelObjectInput<OBJECT>): Promise<OBJECT>;
}

export type ModelCredentialResolver = (
  userId: string,
) => Promise<string | null | undefined> | string | null | undefined;

export class MissingModelCredentialError extends Error {
  readonly code = 'missing_model_credential';

  constructor(readonly userId?: string) {
    super(
      userId
        ? `No model credential configured for user ${userId}.`
        : 'No model credential configured.',
    );
    this.name = 'MissingModelCredentialError';
  }
}

export async function resolveModelCredential(
  userId: string,
  resolveCredential?: ModelCredentialResolver,
): Promise<string> {
  const credential = await resolveCredential?.(userId);

  return requireModelCredential(credential, userId);
}

export function requireModelCredential(
  credential: string | null | undefined,
  userId?: string,
): string {
  const normalizedCredential = credential?.trim();

  if (!normalizedCredential) {
    throw new MissingModelCredentialError(userId);
  }

  return normalizedCredential;
}
