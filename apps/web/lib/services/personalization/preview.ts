import type { Personalization } from "./types";

/**
 * Reproduces what the packaged default prompt actually renders for this owner.
 *
 * This is a MIRROR, not a decoration: it exists so an owner can see the exact
 * text their profile puts in front of the model, and it is only worth having if
 * it agrees with the server. So it reproduces all three server-side rules
 * rather than approximating them:
 *
 * 1. a value empty after trimming is absent, not blank — no orphaned label;
 * 2. account identity renders only when BOTH toggles are on;
 * 3. when nothing survives, the whole block including its framing is omitted.
 *
 * The escaping is reproduced too (`&`, `<`, `>` only, matching the loader's
 * `escapeForPrompt`). Showing `&lt;` where the owner typed `<` looks odd for a
 * moment, but it is the truth, and it is how the fence stays unforgeable.
 *
 * Kept in sync with `apps/api/src/prompts/chat-default.md` and the projection
 * in `apps/api/src/instance-config/prompt-loader.ts`.
 */

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
};

function renderable(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  return trimmed.replace(
    /[&<>]/g,
    (character) => ESCAPES[character] ?? character,
  );
}

export type PreviewAccount = {
  name?: string | null;
  email?: string | null;
};

export type PersonalizationPreview = {
  /** The lines inside `<user_personalization>`, or empty when nothing renders. */
  lines: string[];
  /** True when the whole section — framing prose included — is omitted. */
  empty: boolean;
};

export function buildPersonalizationPreview(
  personalization: Personalization,
  account: PreviewAccount | undefined,
): PersonalizationPreview {
  if (!personalization.enabled) {
    return { lines: [], empty: true };
  }

  const entries: Array<[string, string | undefined]> = [
    ["Preferred name", renderable(personalization.preferredName)],
    ["About them", renderable(personalization.about)],
    ["Response preferences", renderable(personalization.responsePreferences)],
  ];

  if (personalization.shareAccountIdentity) {
    entries.push(
      ["Account name", renderable(account?.name)],
      ["Account email", renderable(account?.email)],
    );
  }

  const lines = entries
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .map(([label, value]) => `${label}: ${value}`);

  return { lines, empty: lines.length === 0 };
}
