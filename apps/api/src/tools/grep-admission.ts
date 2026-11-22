/**
 * Permission admission for the native `grep` tool (grep-tool spec, "Each
 * scope is admitted against the grep group on its literal prefix", and the
 * tool-call-permissions requirement "Grep scopes are admitted per scope and
 * files per hit").
 *
 * The call is evaluated once per scope with `scopes` replaced by that scope's
 * canonical prefix, so a field clause on `scopes` sees one string. A reject
 * may also match the submitted spelling or the decoded path on its Machine,
 * and an all-fields reject traverses every submitted scope, prefix, and
 * projected path through internal keys no clause can name. Each candidate file
 * is then judged against the `read` group as a `read` of its canonical
 * locator, so a hit never names content that `read` refuses.
 */

import {
  decodeGrepLiteralSpelling,
  normalizeHostScope,
  parsePathScheme,
  splitGrepScope,
} from '@workspace/native-file-tools';
import { isString, type UnknownRecord } from '@workspace/runtime-safety';

import { KNOWLEDGE_LOCATOR_SCHEME } from '../knowledge/knowledge-locator';
import {
  formatMachineLocator,
  MACHINE_SCHEME,
} from '../machines/machine-locator';
import { SKILL_LOCATOR_SCHEME } from '../skills/skill-locator';
import {
  admitPermission,
  type CanonicalEvaluation,
  evaluateCanonicalWithRejectTexts,
} from './permissions/admit';
import { isFileAlias } from './permissions/file-alias';
import {
  nativeFileProjection,
  projectNativeFilePath,
  type NativeFileProjection,
} from './permissions/locator-projection';
import {
  type EvaluatePermissionOptions,
  type PermissionDecision,
} from './permissions/types';
import { hostLiteralStart } from './grep-scope-shape';
import { type ToolContext } from './types';
import {
  literalTargetPath,
  locatorContext,
  resolveMachinePath,
  type LocatorContext,
} from './workspace-path';

/** The one array-valued input a clause may name (tool-call-permissions). */
export const GREP_SCOPES_FIELD = 'scopes';

/** A submitted scope with the identity policy matches it as. */
export interface ProjectedGrepScope {
  readonly submitted: string;
  /** The canonical locator prefix, canonical for its scheme; policy matches this. */
  readonly prefix: string;
  /** The decoded absolute prefix on its Machine, without scheme or name. */
  readonly projectedPath?: string;
}

/**
 * The scope strings a call admits: the submitted `scopes`, or the Workspace
 * root when `scopes` is omitted and a Workspace is entered. `undefined` when
 * neither exists, which the tool reports as `invalid_input` after admission.
 */
export function grepScopeStrings(
  args: UnknownRecord,
  root: string | undefined,
): ReadonlyArray<string> | undefined {
  const submitted = args[GREP_SCOPES_FIELD];

  if (Array.isArray(submitted) && submitted.every(isString)) return submitted;

  // The root names a directory, so its prefix carries the separator a
  // directory clause is written with.
  return root === undefined
    ? undefined
    : [root.endsWith('/') ? root : `${root}/`];
}

/**
 * Project one scope to the prefix policy matches as an allow, plus the decoded
 * absolute path a reject written as a bare path also matches. A host scope —
 * bare, relative, or a `file:` alias — is placed by the locator rule on its
 * Machine and normalized lexically, exactly as the walk resolves it; a
 * `machine://` scope takes the same canonical spelling `read` matches, and a
 * `kb://` or `skill://` prefix keeps its logical identity.
 */
export function projectGrepScope(
  scope: string,
  context: LocatorContext = {},
): ProjectedGrepScope {
  const alias = isFileAlias(scope);
  const scheme = alias ? undefined : parsePathScheme(scope);

  if (scheme === undefined || scheme.scheme === MACHINE_SCHEME)
    return projectMachineScope(scope, context, scheme !== undefined, alias);

  if (
    scheme.scheme !== KNOWLEDGE_LOCATOR_SCHEME &&
    scheme.scheme !== SKILL_LOCATOR_SCHEME
  )
    return {
      submitted: scope,
      prefix: projectNativeFilePath(prefixOf(scope), context).canonical,
    };

  // The logical authority is never cut: a glob in it is the reader's to
  // refuse, and only the path part holds the literal prefix.
  const head = scope.slice(0, scope.length - scheme.rest.length);
  const authorityEnd = scheme.rest.indexOf('/');

  const authority =
    authorityEnd === -1 ? scheme.rest : scheme.rest.slice(0, authorityEnd + 1);

  const pathPart =
    authorityEnd === -1 ? '' : scheme.rest.slice(authorityEnd + 1);

  const prefix = `${head}${authority}${prefixOf(pathPart)}`;

  return { submitted: scope, prefix: projectNativeFilePath(prefix).canonical };
}

/**
 * One host or `machine://` scope's canonical prefix. A Machine scope cuts its
 * glob from the submitted text before it decodes, exactly as its own walk
 * does; a host scope resolves whole and normalizes lexically first, so a `..`
 * segment settles the way the engine settles it. The seven literal spellings
 * decode in the model's part only: a Workspace root is a real path, and a
 * `file:` alias is already decoded once by its own grammar.
 */
function projectMachineScope(
  scope: string,
  context: LocatorContext,
  machine: boolean,
  alias: boolean,
): ProjectedGrepScope {
  const cut = splitGrepScope(scope);

  if ('error' in cut) return { submitted: scope, prefix: scope };

  const target = resolveMachinePath(machine ? cut.prefix : scope, context);

  // A scope the resolver refuses never reaches the walk: policy matches the
  // text the refusal names, as it does for `read`.
  if (target.kind !== 'machine') return { submitted: scope, prefix: scope };

  const normalized = normalizeHostScope(literalTargetPath(target));
  const split = machine ? cut : splitGrepScope(normalized);

  if ('error' in split) return { submitted: scope, prefix: scope };

  const prefixText = machine ? normalized : split.prefix;

  const start =
    alias || machine
      ? 0
      : hostLiteralStart(scope, context.workspaceRoot, target.path);

  const projectedPath =
    alias || machine
      ? prefixText
      : prefixText.slice(0, start) +
        decodeGrepLiteralSpelling(prefixText.slice(start));

  return {
    submitted: scope,
    prefix: formatMachineLocator(target.name, projectedPath) ?? projectedPath,
    projectedPath,
  };
}

function prefixOf(pathText: string): string {
  const split = splitGrepScope(pathText);

  return 'error' in split ? pathText : split.prefix;
}

/**
 * The `grep` group decision for one call: the first rejection in scope order,
 * or the allow of the last scope. `undefined` means no trusted policy was
 * supplied, which the runner converts to a fail-closed rejection.
 */
export function evaluateGrepPermission(
  args: UnknownRecord,
  context: ToolContext,
): PermissionDecision | undefined {
  const root = context.workspaceRoot?.current();
  const scopes = grepScopeStrings(args, root);

  if (scopes === undefined) {
    return admitPermission(context, (evaluate) =>
      evaluate({ toolId: 'grep', args }),
    );
  }

  const projected = projectScopes(scopes, context);

  const texts: GrepCallTexts = {
    scopes,
    prefixes: projected.map((scope) => scope.prefix),
    projectedPaths: projected.flatMap((scope) =>
      scope.projectedPath === undefined ? [] : [scope.projectedPath],
    ),
  };

  return admitPermission(context, (evaluate) => {
    let last: PermissionDecision | undefined;

    for (const scope of projected) {
      last = evaluateCanonicalWithRejectTexts(
        evaluate,
        scopeDecisionTexts(args, scope, texts),
      );

      if (last.decision === 'reject') return last;
    }

    // `scopes` is non-empty by schema, so `last` is always decided here.
    return last ?? evaluate({ toolId: 'grep', args });
  });
}

/** Every scope projected against this call's own Machine placement. */
function projectScopes(
  scopes: ReadonlyArray<string>,
  context: ToolContext,
): ReadonlyArray<ProjectedGrepScope> {
  const locator = locatorContext(context);

  return scopes.map((scope) => projectGrepScope(scope, locator));
}

/** Every projected text one call carries through its all-fields rejects. */
type GrepCallTexts = {
  readonly scopes: ReadonlyArray<string>;
  readonly prefixes: ReadonlyArray<string>;
  readonly projectedPaths: ReadonlyArray<string>;
};

/**
 * One scope's texts: its submitted spelling and decoded path are the rejects'
 * to match, and its canonical prefix is the allow's. Every text carries the
 * call's other inputs unchanged.
 */
function scopeDecisionTexts(
  args: UnknownRecord,
  scope: ProjectedGrepScope,
  texts: GrepCallTexts,
): CanonicalEvaluation {
  const rejectTexts: Array<EvaluatePermissionOptions> = [
    {
      toolId: 'grep',
      args: { ...args, [GREP_SCOPES_FIELD]: scope.submitted },
    },
  ];

  if (scope.projectedPath !== undefined)
    rejectTexts.push({
      toolId: 'grep',
      args: { ...args, [GREP_SCOPES_FIELD]: scope.projectedPath },
    });

  return {
    canonical: {
      toolId: 'grep',
      args: {
        ...args,
        [GREP_SCOPES_FIELD]: scope.prefix,
        // Internal keys: traversed by all-fields rejects, never a clause field.
        grepSubmittedScopes: texts.scopes,
        grepScopePrefixes: texts.prefixes,
        grepProjectedPaths: texts.projectedPaths,
      },
    },
    rejectTexts,
  };
}

/** The per-file `read` check and the refusals it counted for the audit. */
export interface GrepReadAdmission {
  /**
   * `true` only when the `read` group allows this canonical locator, and no
   * `read` reject matches one of the extra texts the caller supplies.
   */
  admit(locator: string, rejectTexts?: ReadonlyArray<string>): boolean;
  /**
   * Whether the `read` group would admit this locator, judged without a file
   * record: an excluded directory is counted nowhere and audited nowhere.
   */
  allows(locator: string): boolean;
  /** Files the `read` group refused; owner-visible through the audit only. */
  readonly refused: number;
  /**
   * Record the refusals as one derived `grep-file` decision carrying the
   * count, so the completion audit reports how many files policy hid without
   * one record per file.
   */
  recordRefusals(): void;
}

/**
 * The `read` group's decision for one locator, projected as `read` sees it:
 * the allow is decided on the canonical locator, while a reject also matches
 * the projected path, so a bare-spelled reject keeps its effect on a hit.
 */
export function readDecision(
  context: ToolContext,
  project: NativeFileProjection,
  locator: string,
  extraRejectTexts: ReadonlyArray<string> = [],
): PermissionDecision | undefined {
  const canonical = (field: string, value: string): string =>
    project(field, value).canonical;

  const projectedPath = (field: string, value: string): string => {
    const projection = project(field, value);

    return projection.projectedPath ?? projection.canonical;
  };

  return admitPermission(context, (evaluate) =>
    evaluateCanonicalWithRejectTexts(evaluate, {
      canonical: {
        toolId: 'read',
        args: { path: locator },
        projectFieldValue: canonical,
      },
      rejectTexts: [
        {
          toolId: 'read',
          args: { path: locator },
          projectFieldValue: projectedPath,
        },
        ...extraRejectTexts.map((text) => ({
          toolId: 'read',
          args: { path: text },
        })),
      ],
    }),
  );
}

/** What one call accumulated: refused files and the decision it stands for. */
type ReadAdmissionState = {
  refused: number;
  firstRejection: PermissionDecision | undefined;
};

/** One file's judgement: the call's state, its judge, and the file's texts. */
type FileAdmission = {
  readonly state: ReadAdmissionState;
  readonly verdicts: Map<string, boolean>;
  readonly judge: (
    locator: string,
    rejectTexts?: ReadonlyArray<string>,
  ) => PermissionDecision | undefined;
  readonly locator: string;
  readonly rejectTexts: ReadonlyArray<string> | undefined;
};

/** One file's verdict, counted once for the audit when it is refused. */
function admitFile(input: FileAdmission): boolean {
  const known = input.verdicts.get(input.locator);

  if (known !== undefined) return known;
  const decision = input.judge(input.locator, input.rejectTexts);
  const allowed = decision?.decision === 'allow';
  input.verdicts.set(input.locator, allowed);

  if (allowed) return true;
  input.state.refused += 1;
  input.state.firstRejection ??= decision;

  return false;
}

/**
 * One directory's verdict, judged without a record. A bypass attempt answers
 * its synthetic allow without consulting the policy, so no excluded directory
 * is evaluated.
 */
function allowsDirectory(
  directories: Map<string, boolean>,
  judge: (
    locator: string,
    rejectTexts?: ReadonlyArray<string>,
  ) => PermissionDecision | undefined,
  locator: string,
): boolean {
  const known = directories.get(locator);

  if (known !== undefined) return known;
  const allowed = judge(locator)?.decision === 'allow';
  directories.set(locator, allowed);

  return allowed;
}

/** Record the call's refused files as one derived decision carrying the count. */
function recordRefusal(context: ToolContext, state: ReadAdmissionState): void {
  // Set exactly when a file was refused.
  if (state.firstRejection === undefined) return;
  context.onDerivedDecision?.({
    kind: 'grep-file',
    url: '',
    decision: state.firstRejection,
    count: state.refused,
  });
}

export function createGrepReadAdmission(
  context: ToolContext,
): GrepReadAdmission {
  const project = nativeFileProjection('read', locatorContext(context));

  const judge = (locator: string, rejectTexts?: ReadonlyArray<string>) =>
    readDecision(context, project, locator, rejectTexts);

  // One verdict per file for the whole call: overlapping scopes and a file a
  // Machine returns on two pages count one refused file once. Directory
  // verdicts stay apart: they are never a refused file.
  const verdicts = new Map<string, boolean>();
  const directories = new Map<string, boolean>();
  const state: ReadAdmissionState = { refused: 0, firstRejection: undefined };

  return {
    admit: (locator, rejectTexts) =>
      admitFile({
        state,
        verdicts,
        judge,
        locator,
        rejectTexts,
      }),
    allows: (locator) => allowsDirectory(directories, judge, locator),
    get refused() {
      return state.refused;
    },
    recordRefusals: () => recordRefusal(context, state),
  };
}
