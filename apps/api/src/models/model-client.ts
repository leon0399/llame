import type {
  FinishReason,
  LanguageModelUsage,
  ModelMessage,
  StreamTextOnErrorCallback,
  streamText,
} from 'ai';

export interface ModelStreamInput {
  messages: ModelMessage[];
  system?: string;
  abortSignal?: AbortSignal;
  /**
   * Called for each streamed text delta (#48/#49): lets the loop persist
   * model.delta run events without consuming the result stream itself.
   * A narrow seam by design — providers map their chunk shapes onto plain text.
   */
  onTextDelta?: (text: string) => void;
  onError?: StreamTextOnErrorCallback;
  onFinish?: (event: {
    text: string;
    usage: LanguageModelUsage;
    finishReason: FinishReason;
  }) => void | Promise<void>;
}

export interface ModelClient {
  readonly model: string;
  readonly provider: string;
  streamText(input: ModelStreamInput): ReturnType<typeof streamText>;
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
