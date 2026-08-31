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
 * 5. single-line entries render as `Label: value` lines, while the multi-line
 *    fields render as their own `###` subsections, each preceded by a blank
 *    line — including the newline layout, which the template's standalone
 *    conditionals produce and which this reproduces exactly.
 *
 * Kept in sync with `apps/api/src/prompts/chat-default.md` and the projection
 * in `apps/api/src/instance-config/prompt-loader.ts`.
 */

const ESCAPES = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
} satisfies Record<string, string>;

const escapeStrict = (value: string) =>
  value.replaceAll(/[&<>]/g, (character) => {
    // SAFETY: the regex this replaces on only ever matches "&", "<", or
    // ">" — exactly `ESCAPES`'s keys — so this narrows the match to one
    // guaranteed to be present.
    return ESCAPES[character as keyof typeof ESCAPES] ?? character;
  });

/**
 * The single omission rule, mirroring the loader's: trim, and treat a value
 * empty afterwards as absent. Parameterized by the transform so authored and
 * identity fields cannot drift apart on when they render, only on how.
 */
function projectValue(
  value: string | null | undefined,
  transform: (value: string) => string,
): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  return transform(trimmed);
}

export type PreviewAccount = {
  name?: string | null;
  email?: string | null;
};

export type PersonalizationPreview = {
  /**
   * Exactly the bytes between the fence's opening line and its closing tag —
   * trailing newline included, because the template's own `{{/if}}` lines
   * leave one. Byte-equality with the server render is the point of this
   * type, so nothing here is normalized for looks.
   */
  text: string;
  /** True when the whole section — framing prose included — is omitted. */
  empty: boolean;
};

const rendered = (entry: [string, string | undefined]) =>
  entry[1] !== undefined;

export function buildPersonalizationPreview(
  personalization: Personalization,
  account: PreviewAccount | undefined,
): PersonalizationPreview {
  if (!personalization.enabled) {
    return { text: "", empty: true };
  }

  const inline: Array<[string, string | undefined]> = [
    [
      "Preferred name",
      projectValue(personalization.preferredName, sanitizeAuthoredText),
    ],
  ];
  if (personalization.shareAccountIdentity) {
    inline.push(
      ["Account name", projectValue(account?.name, escapeStrict)],
      ["Account email", projectValue(account?.email, escapeStrict)],
    );
  }

  const blocks: Array<[string, string | undefined]> = [
    ["About them", projectValue(personalization.about, sanitizeAuthoredText)],
    [
      "Response preferences",
      projectValue(personalization.responsePreferences, sanitizeAuthoredText),
    ],
  ];

  // Each conditional in the template is Handlebars-standalone, so a rendered
  // entry contributes its own line and an absent one contributes nothing. The
  // heading blocks additionally open with a blank line.
  const text = [
    ...inline
      .filter(rendered)
      .map(([label, value]) => `${label}: ${String(value)}\n`),
    ...blocks
      .filter(rendered)
      .map(([heading, value]) => `\n### ${heading}\n\n${String(value)}\n`),
  ].join("");

  return { text, empty: text.length === 0 };
}
