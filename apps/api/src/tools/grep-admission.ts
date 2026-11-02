/**
 * Permission admission for the native `grep` tool (grep-tool spec, "Each
 * scope is admitted against the grep group on its literal prefix", and the
 * tool-call-permissions requirement "Grep scopes are admitted per scope and
 * files per hit").
 *
 * The call is evaluated once per scope with `scopes` replaced by that scope's
 * projected literal prefix, so a field clause on `scopes` sees one string. An
 * all-fields reject additionally traverses the submitted scope texts and every
 * prefix through two internal keys no clause can name. Each candidate file is
 * then judged against the `read` group as a `read` of its canonical locator,
 * so a hit never names content that `read` refuses.
 */

import {
  decodeGrepLiteralSpelling,
  normalizeHostScope,
  parsePathScheme,
  splitGrepScope,
} from '@workspace/native-file-tools';
import { isString, type UnknownRecord } from '@workspace/runtime-safety';

import { KNOWLEDGE_LOCATOR_SCHEME } from '../knowledge/knowledge-locator';
import { MACHINE_SCHEME } from '../machines/machine-locator';
import { SKILL_LOCATOR_SCHEME } from '../skills/skill-locator';
import { admitPermission } from './permissions/admit';
import { isFileAlias } from './permissions/file-alias';
import {
  nativeFileProjection,
  projectNativeFilePath,
} from './permissions/locator-projection';
import { type PermissionDecision } from './permissions/types';
import { type ToolContext } from './types';
import {
  isWorkspaceRelative,
  mapToWorkspaceHost,
  resolveWorkspacePath,
} from './workspace-path';

/** The one array-valued input a clause may name (tool-call-permissions). */
export const GREP_SCOPES_FIELD = 'scopes';

/** A submitted scope with the identity policy matches it as. */
export interface ProjectedGrepScope {
  readonly submitted: string;
  /** The literal prefix, canonical for its scheme; policy matches this. */
  readonly prefix: string;
}

const LOGICAL_SCHEMES = {
  [KNOWLEDGE_LOCATOR_SCHEME]: true,
  [SKILL_LOCATOR_SCHEME]: true,
  [MACHINE_SCHEME]: true,
} as const;

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
 * Project one scope to the literal prefix policy matches. A relative or bare
 * absolute host scope is first placed by the Workspace rule, host and Machine
 * paths are normalized lexically, and a `file:` alias is decoded before that
 * normalization, so its `..` text is matched as the path it resolves to. Any
 * other prefix is cut at the first glob segment of the submitted text before
 * decoding; `kb://`, `skill://`, and `machine://` prefixes then take the
 * canonical spelling `read` matches.
 */
export function projectGrepScope(
  scope: string,
  root: string | undefined,
): ProjectedGrepScope {
  const placed =
    root === undefined || isFileAlias(scope)
      ? scope
      : isWorkspaceRelative(scope)
        ? resolveWorkspacePath(root, scope)
        : mapToWorkspaceHost(root, scope);
  const scheme = parsePathScheme(placed);
  if (scheme === undefined || !Object.hasOwn(LOGICAL_SCHEMES, scheme.scheme)) {
    // A `file:` alias is decoded first, then normalized like any host path, so
    // `..` text it carried cannot be matched by policy as written.
    const normalized = normalizeHostScope(projectNativeFilePath(placed));
    // The host prefix decodes the seven literal spellings, exactly as the walk
    // probes it, so a reject written against `app/[id]` sees `app/%5Bid%5D`.
    return {
      submitted: scope,
      prefix: decodeGrepLiteralSpelling(prefixOf(normalized)),
    };
  }
  const head = placed.slice(0, placed.length - scheme.rest.length);
  const authorityEnd = scheme.rest.indexOf('/');
  const authority =
    authorityEnd === -1 ? scheme.rest : scheme.rest.slice(0, authorityEnd + 1);
  const pathPart =
    authorityEnd === -1 ? '' : scheme.rest.slice(authorityEnd + 1);
  const prefix = `${head}${authority}${prefixOf(pathPart)}`;
  return { submitted: scope, prefix: projectNativeFilePath(prefix) };
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
  const projected = scopes.map((scope) => projectGrepScope(scope, root));
  const prefixes = projected.map((scope) => scope.prefix);
  return admitPermission(context, (evaluate) => {
    let last: PermissionDecision | undefined;
    for (const scope of projected) {
      last = evaluate({
        toolId: 'grep',
        args: {
          ...args,
          [GREP_SCOPES_FIELD]: scope.prefix,
          // Internal keys: traversed by all-fields rejects, never a clause field.
          grepSubmittedScopes: scopes,
          grepScopePrefixes: prefixes,
        },
      });
      if (last.decision === 'reject') return last;
    }
    // `scopes` is non-empty by schema, so `last` is always decided here.
    return last ?? evaluate({ toolId: 'grep', args });
  });
}

/** The per-file `read` check and the refusals it counted for the audit. */
export interface GrepReadAdmission {
  /** `true` only when the `read` group allows a read of this canonical locator. */
  admit(locator: string): boolean;
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

/** The `read` group's decision for one locator, projected as `read` sees it. */
function readDecision(
  context: ToolContext,
  project: (field: string, value: string) => string,
  locator: string,
): PermissionDecision | undefined {
  return admitPermission(context, (evaluate) =>
    evaluate({
      toolId: 'read',
      args: { path: locator },
      projectFieldValue: project,
    }),
  );
}

/** What one call accumulated: refused files and the decision it stands for. */
type ReadAdmissionState = {
  refused: number;
  firstRejection: PermissionDecision | undefined;
};

/** One file's verdict, counted once for the audit when it is refused. */
function admitFile(
  state: ReadAdmissionState,
  verdicts: Map<string, boolean>,
  judge: (locator: string) => PermissionDecision | undefined,
  locator: string,
): boolean {
  const known = verdicts.get(locator);
  if (known !== undefined) return known;
  const decision = judge(locator);
  const allowed = decision?.decision === 'allow';
  verdicts.set(locator, allowed);
  if (allowed) return true;
  state.refused += 1;
  state.firstRejection ??= decision;
  return false;
}

/**
 * One directory's verdict, judged without a record. A bypass attempt answers
 * its synthetic allow without consulting the policy, so no excluded directory
 * is evaluated.
 */
function allowsDirectory(
  directories: Map<string, boolean>,
  judge: (locator: string) => PermissionDecision | undefined,
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
  const project = nativeFileProjection(
    'read',
    context.workspaceRoot?.current(),
  );
  const judge = (locator: string) => readDecision(context, project, locator);
  // One verdict per file for the whole call: overlapping scopes and a file a
  // Machine returns on two pages count one refused file once. Directory
  // verdicts stay apart: they are never a refused file.
  const verdicts = new Map<string, boolean>();
  const directories = new Map<string, boolean>();
  const state: ReadAdmissionState = { refused: 0, firstRejection: undefined };
  return {
    admit: (locator) => admitFile(state, verdicts, judge, locator),
    allows: (locator) => allowsDirectory(directories, judge, locator),
    get refused() {
      return state.refused;
    },
    recordRefusals: () => recordRefusal(context, state),
  };
}
