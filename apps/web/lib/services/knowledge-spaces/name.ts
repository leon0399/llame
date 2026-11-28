/** A Knowledge Space name is 1–100 Unicode code points after trimming. */
export const KNOWLEDGE_SPACE_NAME_MAX = 100;

/** The same characters the API rejects: control, format, and line separators. */
const INVALID_NAME_CHARACTERS = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

/** A message for an invalid name, or null when the trimmed name can be saved. */
export function knowledgeSpaceNameError(value: string): string | null {
  const name = value.trim();
  const length = Array.from(name).length;

  if (length < 1) return "Enter a name.";

  if (length > KNOWLEDGE_SPACE_NAME_MAX) {
    return "Use 100 characters or fewer.";
  }

  if (INVALID_NAME_CHARACTERS.test(name)) {
    return "Remove hidden or control characters.";
  }

  return null;
}
