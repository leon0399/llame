export class ModelContextExecutionError extends Error {
  readonly code: string = 'model_context_incompatible';

  constructor(message: string) {
    super(message);
    this.name = 'ModelContextExecutionError';
  }
}

export class ContextIncompatibleError extends ModelContextExecutionError {
  override readonly code = 'context_incompatible';

  constructor(message: string, options?: ErrorOptions) {
    super(message);
    this.name = 'ContextIncompatibleError';
    if (options?.cause !== undefined) {
      this.cause = options.cause;
    }
  }
}
