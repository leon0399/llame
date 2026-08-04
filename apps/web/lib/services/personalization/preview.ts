import { sanitizeAuthoredText } from "./sanitize";
import type { Personalization } from "./types";

/**
 * Reproduces what the packaged default prompt actually renders for this owner.
 *
 * This is a MIRROR, not a decoration: it exists so an owner can see the exact
 * text their profile puts in front of the model, and it is only worth having if
 * it agrees with the server. So it reproduces the server-side rules rather
 * than approximating them:
 *
 * 1. a value empty after trimming is absent, not blank — no orphaned label;
 * 2. account identity renders only when BOTH toggles are on;
 * 3. when nothing survives, the whole block including its framing is omitted;
 * 4. authored fields pass through the tag-balance sanitizer (`sanitize.ts`),
 *    so self-contained markup shows verbatim while a closer for a tag the
 *    value did not open shows escaped — the truth of how the fence stays
 *    unforgeable; account identity keeps the strict `&<>` escape;
 * 5. single-line entries render as `Label: value`, while the multi-line
 *    fields render as their own `###` subsections, matching the template.
 *
 * Kept in sync with `apps/api/src/prompts/chat-default.md` and the projection
 * in `apps/api/src/instance-config/prompt-loader.ts`.
 */

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
};

function identityValue(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  return trimmed.replace(
    /[&<>]/g,
    (character) => ESCAPES[character] ?? character,
  );
}

function authoredValue(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  return sanitizeAuthoredText(trimmed);
}

export type PreviewAccount = {
  name?: string | null;
  email?: string | null;
};

export type PersonalizationPreview = {
  /**
   * The content inside `<user_personalization>`, or empty when nothing
   * renders. Content-exact against the server render; blank-line spacing is
   * normalized.
   */
  text: string;
  /** True when the whole section — framing prose included — is omitted. */
  empty: boolean;
};

export function buildPersonalizationPreview(
  personalization: Personalization,
  account: PreviewAccount | undefined,
): PersonalizationPreview {
  if (!personalization.enabled) {
    return { text: "", empty: true };
  }

  const inline: Array<[string, string | undefined]> = [
    ["Preferred name", authoredValue(personalization.preferredName)],
  ];
  if (personalization.shareAccountIdentity) {
    inline.push(
      ["Account name", identityValue(account?.name)],
      ["Account email", identityValue(account?.email)],
    );
  }

  const blocks: Array<[string, string | undefined]> = [
    ["About them", authoredValue(personalization.about)],
    [
      "Response preferences",
      authoredValue(personalization.responsePreferences),
    ],
  ];

  const inlineLines = inline
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .map(([label, value]) => `${label}: ${value}`)
    .join("\n");

  const sections = [
    inlineLines,
    ...blocks
      .filter((entry): entry is [string, string] => entry[1] !== undefined)
      .map(([heading, value]) => `### ${heading}\n\n${value}`),
  ].filter((section) => section.length > 0);

  const text = sections.join("\n\n");
  return { text, empty: text.length === 0 };
}
