/**
 * Mirrors `PersonalizationResponse` / `UpdatePersonalizationDto` in
 * `apps/api/src/personalization/dto/personalization.dto.ts`. Field names match
 * the prompt-template context paths exactly (`user.personalization.*`), so the
 * settings vocabulary and what an operator writes in a prompt file cannot drift
 * apart.
 */
export type Personalization = {
  preferredName: string | null;
  about: string | null;
  responsePreferences: string | null;
  /** Master switch over all per-user prompt context, including identity. */
  enabled: boolean;
  /** Additionally gates the account display name and email address. */
  shareAccountIdentity: boolean;
};

/**
 * A partial update. An omitted key leaves the stored value untouched; an
 * explicit `null` clears it — the two mean different things, so the editor must
 * not collapse them by sending `""` for a cleared field.
 */
export type PersonalizationUpdate = Partial<Personalization>;

/**
 * Server-enforced caps, duplicated here so the editor can show remaining
 * characters before a round trip. The API rejects anything longer regardless —
 * this is a courtesy, never the enforcement.
 *
 * Keep in sync with `PERSONALIZATION_CAPS` in
 * `apps/api/src/personalization/personalization.constants.ts`.
 */
export const PERSONALIZATION_CAPS = {
  preferredName: 255,
  about: 8000,
  responsePreferences: 8000,
} as const;

export type PersonalizationTextField = keyof typeof PERSONALIZATION_CAPS;
