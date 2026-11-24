/**
 * The `modelRoles` types: the operator's raw entries once the published schema
 * validated them, and what the boot loader resolves them to. They live apart
 * from `llame-config.ts` so that module describes the whole document without
 * carrying this block too.
 */

/** One still-uninterpolated `modelRoles.<name>.candidates[]` item once schema-validated. */
export type RawModelRoleCandidate = {
  model: string;
  effort?: string;
};

/** One still-uninterpolated `modelRoles.<name>` entry once schema-validated. */
export type RawModelRole = {
  candidates: ReadonlyArray<RawModelRoleCandidate>;
};

/**
 * One resolved model role candidate (model roles, design D1): the model it
 * names, plus the provider-native effort level it runs at when the role
 * declares one.
 */
export type ModelRoleCandidate = {
  readonly modelId: string;
  readonly effort?: string;
};

/** A resolved named model role: an ordered candidate list, primary first. */
export type ModelRoleConfig = {
  readonly name: string;
  readonly candidates: ReadonlyArray<ModelRoleCandidate>;
};
