/** A Knowledge Space name is 1–100 Unicode code points after trimming. */
export const KNOWLEDGE_SPACE_NAME_MAX = 100;

/** A message for an invalid name, or null when the trimmed name can be saved. */
export function knowledgeSpaceNameError(value: string): string | null {
  const length = Array.from(value.trim()).length;

  if (length < 1) return "Enter a name.";

  if (length > KNOWLEDGE_SPACE_NAME_MAX) {
    return "Use 100 characters or fewer.";
  }

  return null;
}
