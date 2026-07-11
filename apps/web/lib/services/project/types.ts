// Mirrors apps/api/src/projects/dto/projects.dto.ts's ProjectResponse. Kept as
// a plain type here (no codegen yet — SPEC §22.0 defers client/SDK codegen
// post-v0.1), same convention as ../org-units/types.ts — any drift from the
// API surface must be caught by hand or by the e2e, not a type-checker across
// the wire.
export type ProjectResponse = {
  id: string;
  ownerUserId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
};
