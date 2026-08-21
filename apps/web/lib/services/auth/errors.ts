export class InvalidCredentialsError extends Error {
  constructor() {
    super("Invalid email or password");
    this.name = "InvalidCredentialsError";
  }
}

export function isInvalidCredentialsError(
  error: unknown,
): error is InvalidCredentialsError {
  return error instanceof InvalidCredentialsError;
}
