import { isString } from '@workspace/runtime-safety';

const INVALID_NAME_CHARACTERS = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

export class KnowledgeSpaceNameError extends Error {
  constructor() {
    super(
      'Knowledge Space name must be 1-100 Unicode code points without control characters.',
    );
    this.name = 'KnowledgeSpaceNameError';
  }
}

export function normalizeKnowledgeSpaceName(value: string): string {
  const name = value.trim();
  const codePointLength = Array.from(name).length;
  if (
    codePointLength < 1 ||
    codePointLength > 100 ||
    INVALID_NAME_CHARACTERS.test(name)
  ) {
    throw new KnowledgeSpaceNameError();
  }

  return name;
}

export function isValidKnowledgeSpaceName(
  value: string | null | undefined,
): boolean {
  if (!isString(value)) return false;
  try {
    normalizeKnowledgeSpaceName(value);
    return true;
  } catch {
    return false;
  }
}
