import type {
  PersonalizationResponse,
  UpdatePersonalizationDto,
} from "../../api/generated/models";

export type { PersonalizationResponse, UpdatePersonalizationDto };

/** Feature-facing alias for the generated response contract. */
export type Personalization = PersonalizationResponse;

/**
 * The generated request currently emits nullable strings as object-shaped
 * fields because of an OpenAPI metadata limitation. Keep the feature facade
 * faithful to the runtime DTO while retaining generated boolean fields.
 */
export type PersonalizationUpdate = Omit<
  UpdatePersonalizationDto,
  "preferredName" | "about" | "responsePreferences"
> & {
  preferredName?: string | null;
  about?: string | null;
  responsePreferences?: string | null;
};

/**
 * Server-enforced caps, duplicated here so the editor can show remaining
 * characters before a round trip. The API rejects anything longer regardless
 * — this is a courtesy, never the enforcement.
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
