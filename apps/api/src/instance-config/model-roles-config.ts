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

/** Matrix cell for automatic model failover. */
export type RawFailoverCell =
  | 'on'
  | 'off'
  | { switchAfterSeconds: number | string };

export type RawFailoverMatrix = Partial<
  Record<
    'owner' | 'agent',
    Partial<Record<'availability' | 'access' | 'quota', RawFailoverCell>>
  >
>;

export type FailoverCell =
  | 'on'
  | 'off'
  | { readonly switchAfterSeconds: number };

export type FailoverMatrix = Readonly<
  Partial<
    Record<
      'owner' | 'agent',
      Readonly<
        Partial<Record<'availability' | 'access' | 'quota', FailoverCell>>
      >
    >
  >
>;

/** One still-uninterpolated `modelRoles.<name>` entry once schema-validated. */
export type RawModelRole = {
  candidates: ReadonlyArray<RawModelRoleCandidate>;
  allowPaidFallback?: boolean;
  failover?: RawFailoverMatrix;
};

/** A resolved named model role: ordered candidates and optional policy overrides. */
export type ModelRoleConfig = {
  readonly name: string;
  readonly candidates: ReadonlyArray<ModelRoleCandidate>;
  readonly allowPaidFallback?: boolean;
  readonly failover?: FailoverMatrix;
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
