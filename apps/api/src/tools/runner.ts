import { isBashTool } from './bash';
import { isNativeFileTool } from './native-files';

import {
  isRecord,
  isString,
  type UnknownRecord,
} from '@workspace/runtime-safety';
import { safeParseArgs } from './schema-utils';
import { hasValidTrustedTimeout } from './turn-tool-catalog';
import { cancelledBeforeExecution } from './cancelled-before-execution';
import { type Tool, type ToolContext, type ToolResult } from './types';
import { evaluateGrepPermission } from './grep-admission';
import { refuseUnsearchableGrepScopes } from './grep-scopes';
import {
  admitPermission,
  evaluateCanonicalWithRejectTexts,
  evaluateSubmittedThenProjected,
  readOnlyCeiling,
} from './permissions/admit';
import { isBashCommandField } from './permissions/bash-command-field';
import { declaredStringProperties } from './permissions/declared-fields';
import {
  NATIVE_FILE_PERMISSION_TOOL_IDS,
  nativeFileProjection,
  withoutReadSelector,
  type NativeFileProjection,
} from './permissions/locator-projection';
import { permissionDeniedResult } from './permissions/messages';
import {
  canonicalMachineLocator,
  locatorContext,
  resolveMachinePath,
  type LocatorContext,
} from './workspace-path';
import { isMachineLocator } from '../machines/machine-locator';
import {
  admitSshCall,
  isSshBash,
  isSshRead,
  type SshAdmission,
} from './ssh-admission';
import {
  type EvaluatePermissionOptions,
  type PermissionDecision,
} from './permissions/types';
import { executeAdmittedTool } from './admitted-tool-execution';

export { unknownMcpExecution } from './admitted-tool-execution';

/** The admission of a call that names no `ssh://` destination. */
const NO_SSH: SshAdmission = { kind: 'none' };

/** Structured refusal for a tool the model requested but is unavailable (D3/D6). */
export function refusalResult(toolName: string): ToolResult {
  return {
    status: 'error',
    type: 'not_available',
    message: `Tool "${toolName}" is not available.`,
  };
}

/** Structured error for a hallucinated/invalid tool call the SDK couldn't parse. */
export function invalidCallResult(toolName: string): ToolResult {
  return {
    status: 'error',
    type: 'invalid_input',
    message: `The call to "${toolName}" had invalid arguments.`,
  };
}

/** The admitted schema of an MCP tool is static for the process lifetime. */
const declaredFieldCache = new WeakMap<Tool, ReadonlySet<string>>();

/**
 * Declared string fields for a dynamic MCP tool, checked against its currently
 * admitted declaration. A code-owned tool returns `undefined` (its fields were
 * validated at boot); an MCP tool with an unreadable declaration returns an
 * empty set so every configured field clause fails closed.
 */
function mcpDeclaredStringFields(tool: Tool): ReadonlySet<string> | undefined {
  if (!tool.id.startsWith('mcp__')) return undefined;
  const cached = declaredFieldCache.get(tool);

  if (cached !== undefined) return cached;

  const fields = isRecord(tool.inputSchema)
    ? declaredStringProperties(tool.inputSchema)
    : new Set<string>();

  declaredFieldCache.set(tool, fields);

  return fields;
}

type SubmittedToolArguments = UnknownRecord;

function projectWorkspaceArguments(
  tool: Tool,
  args: SubmittedToolArguments,
  locator: LocatorContext,
  bashCwd: BashCwdProjection,
): SubmittedToolArguments {
  if (isNativeFileTool(tool) || tool.id === 'enter_workspace')
    return projectNativeFileArguments(args, locator);

  if (isBashTool(tool)) return projectBashArguments(args, bashCwd);

  return args;
}

/**
 * A native `path`: the one locator rule decides its Machine, so a relative or
 * bare absolute path projects to a canonical locator even with no Workspace
 * (a `machines.default` is enough), and a written locator is canonicalized.
 * Policy must see the address the call will actually reach.
 */
function projectNativeFileArguments(
  args: SubmittedToolArguments,
  locator: LocatorContext,
): SubmittedToolArguments {
  const path = args.path;

  if (!isString(path)) return args;
  const target = resolveMachinePath(path, locator);

  return target.kind === 'machine' && target.locator !== path
    ? { ...args, path: target.locator }
    : args;
}

/** A `bash` cwd as the one locator rule reads it: the text policy allows on,
 *  and the decoded Machine path a reject written against a bare path names. */
type BashCwdProjection = {
  readonly canonical?: string;
  readonly projectedPath?: string;
};

function projectBashCwd(
  cwd: string | undefined,
  context: LocatorContext,
): BashCwdProjection {
  const value = cwd ?? context.workspaceRoot;

  if (value === undefined) return {};
  const target = resolveMachinePath(value, context);

  if (target.kind === 'machine')
    return { canonical: target.locator, projectedPath: target.path };

  // A Machine listing keeps its submitted text; any other scheme keeps the
  // caller's routing and is matched as written.
  return {
    canonical: isMachineLocator(value) ? canonicalMachineLocator(value) : value,
  };
}

/**
 * `bash`'s `cwd`: a `machine://` locator is canonicalized as written, and an
 * omitted, Workspace-relative, or bare absolute one resolves the way a native
 * path does. An omitted cwd with no Workspace stays unmatched.
 */
function projectBashArguments(
  args: SubmittedToolArguments,
  bashCwd: BashCwdProjection,
): SubmittedToolArguments {
  const cwd = isString(args.cwd) ? args.cwd : undefined;

  if (args.cwd !== undefined && cwd === undefined) return args;

  return bashCwd.canonical === undefined || bashCwd.canonical === args.cwd
    ? args
    : { ...args, cwd: bashCwd.canonical };
}

/**
 * The canonical file a read reaches, when it differs from the submitted
 * resource: a selector windows the read and is never part of the identity,
 * even when the value had no Machine to project to.
 */
function canonicalReadTarget(
  evaluation: LocatorEvaluation,
  canonicalPath: string | undefined,
): string | undefined {
  if (
    canonicalPath === undefined ||
    evaluation.tool.id !== 'read' ||
    !isString(evaluation.workspaceArgs.path)
  ) {
    return undefined;
  }

  const evaluatedPath = withoutReadSelector(
    evaluation.canonicalValue('path', evaluation.workspaceArgs.path),
  );

  return canonicalPath === evaluatedPath ? undefined : canonicalPath;
}

/**
 * The canonical file a read reaches (a followed link) is judged under the same
 * `read` group, and a reject also matches its projected path — the bare path
 * on its Machine — so a bare-spelled reject keeps its effect on a hit.
 */
function evaluateCanonicalReadPermission(
  context: ToolContext,
  evaluation: LocatorEvaluation,
  decision: PermissionDecision | undefined,
): PermissionDecision | undefined {
  const canonicalPath = canonicalReadTarget(
    evaluation,
    context.canonicalReadPath,
  );

  if (canonicalPath === undefined) return decision;

  const canonicalDecision = admitPermission(context, (evaluate) =>
    evaluateCanonicalWithRejectTexts(evaluate, {
      canonical: {
        ...evaluation.canonicalOptions,
        args: { path: canonicalPath },
      },
      rejectTexts: [
        {
          ...evaluation.optionsFor({ path: canonicalPath }),
          projectFieldValue: (field: string, value: string): string =>
            projectedFieldValue(evaluation.project, field, value),
        },
      ],
    }),
  );

  if (canonicalDecision !== undefined) {
    context.onDerivedDecision?.({
      kind: 'canonical',
      url: canonicalPath,
      decision: canonicalDecision,
    });

    if (canonicalDecision.decision === 'reject') return canonicalDecision;
  }

  return decision;
}

/**
 * Evaluate the trusted process policy for one already-schema-validated call.
 * `undefined` means no trusted policy was supplied (a code error); the caller
 * converts it to a fail-closed rejection. The originally submitted `args` are
 * matched except for Workspace-projected native paths and Bash cwd values;
 * those projected values are matched instead of their submitted spelling.
 *
 * A native locator is judged twice when normalizing changes it — a web
 * locator whose host, port, encoding, or fragment the request rewrites, or a
 * `kb://`/`skill://` locator written in an equivalent spelling. Any reject
 * that either text matches refuses the call, so a spelling cannot be
 * arranged to miss a reject clause. The allow comes from the normalized text,
 * because an allow names the resource the call will actually reach and the
 * two texts are one resource; a redirect hop is a different resource, which
 * is why each hop is admitted in its own right instead.
 */
function evaluateToolPermission(
  tool: Tool,
  args: SubmittedToolArguments,
  context: ToolContext,
): PermissionDecision | undefined {
  // `grep` is admitted once per scope on each scope's literal prefix.
  if (tool.id === 'grep') return evaluateGrepPermission(args, context);

  return evaluateLocatorToolPermission(tool, args, context);
}

/** One locator tool's prepared evaluation: its projections and its texts. */
type LocatorEvaluation = {
  readonly tool: Tool;
  readonly args: SubmittedToolArguments;
  readonly workspaceArgs: SubmittedToolArguments;
  readonly optionsFor: (
    callArgs: SubmittedToolArguments,
  ) => EvaluatePermissionOptions;
  /** The scheme-aware projection of one field, as the tool itself reads it. */
  readonly project: NativeFileProjection;
  readonly canonicalValue: (field: string, value: string) => string;
  readonly canonicalOptions: EvaluatePermissionOptions;
  /** The trusted facts every projection of this call resolves against. */
  readonly locator: LocatorContext;
  /** Bash's resolved cwd, computed once for its allow and its reject text. */
  readonly bashCwd: BashCwdProjection;
};

/** The evaluator options of one call's submitted arguments. */
function permissionOptionsFor(
  tool: Tool,
): (callArgs: SubmittedToolArguments) => EvaluatePermissionOptions {
  return (callArgs) => ({
    toolId: tool.id,
    args: callArgs,
    isFlexibleWhitespaceField: (field: string) =>
      isBashCommandField(tool.id, field),
    validFields: mcpDeclaredStringFields(tool),
  });
}

/** The canonical text of one projected field. */
function canonicalValueFor(
  project: NativeFileProjection,
): (field: string, value: string) => string {
  return (field, value) => project(field, value).canonical;
}

/** A projection's reject text: the decoded Machine path, else the canonical. */
function projectedFieldValue(
  project: NativeFileProjection,
  field: string,
  value: string,
): string {
  const projection = project(field, value);

  return projection.projectedPath ?? projection.canonical;
}

/** Everything one locator call decides, prepared before its group is chosen. */
function prepareLocatorEvaluation(
  tool: Tool,
  args: SubmittedToolArguments,
  context: ToolContext,
): LocatorEvaluation {
  const locator = locatorContext(context);

  const bashCwd = isBashTool(tool)
    ? projectBashCwd(isString(args.cwd) ? args.cwd : undefined, locator)
    : {};

  const workspaceArgs = projectWorkspaceArguments(tool, args, locator, bashCwd);

  const project = nativeFileProjection(tool.id, locator);
  const optionsFor = permissionOptionsFor(tool);
  const canonicalValue = canonicalValueFor(project);

  return {
    tool,
    args,
    workspaceArgs,
    optionsFor,
    project,
    canonicalValue,
    locator,
    bashCwd,
    canonicalOptions: {
      ...optionsFor(workspaceArgs),
      projectFieldValue: canonicalValue,
    },
  };
}

/**
 * The submitted text's own options: a read's selector windows the resource and
 * never becomes part of the text its group matches.
 */
function submittedOptions(
  evaluation: LocatorEvaluation,
): EvaluatePermissionOptions {
  return {
    ...evaluation.optionsFor(evaluation.args),
    projectFieldValue:
      evaluation.tool.id === 'read'
        ? (field: string, value: string) =>
            field === 'path' ? withoutReadSelector(value) : value
        : undefined,
  };
}

/**
 * A native path tool's decision: an allow is decided on the canonical locator
 * alone, while a reject that matches the submitted spelling or the decoded
 * Machine path still refuses (design D7).
 */
function nativePathDecision(
  context: ToolContext,
  evaluation: LocatorEvaluation,
): PermissionDecision | undefined {
  const rejectTexts: Array<EvaluatePermissionOptions> = [
    submittedOptions(evaluation),
    {
      ...evaluation.optionsFor(evaluation.args),
      projectFieldValue: (field: string, value: string) => {
        const projection = evaluation.project(field, value);

        return projection.projectedPath ?? projection.canonical;
      },
    },
  ];

  return admitPermission(context, (evaluate) =>
    evaluateCanonicalWithRejectTexts(evaluate, {
      canonical: evaluation.canonicalOptions,
      rejectTexts,
    }),
  );
}

/** Bash's decision: the resolved cwd allows, and its Machine path rejects. */
function bashPermissionDecision(
  context: ToolContext,
  evaluation: LocatorEvaluation,
): PermissionDecision | undefined {
  const rejectTexts = [evaluation.optionsFor(evaluation.args)];

  if (evaluation.bashCwd.projectedPath !== undefined)
    rejectTexts.push(
      evaluation.optionsFor({
        ...evaluation.args,
        cwd: evaluation.bashCwd.projectedPath,
      }),
    );

  return admitPermission(context, (evaluate) =>
    evaluateCanonicalWithRejectTexts(evaluate, {
      canonical: evaluation.canonicalOptions,
      rejectTexts,
    }),
  );
}

/**
 * Every other tool keeps its own two-text rules; its projection is the
 * scheme-aware one from `nativeFileProjection` (and none at all for MCP).
 */
function submittedPermissionDecision(
  context: ToolContext,
  evaluation: LocatorEvaluation,
): PermissionDecision | undefined {
  return admitPermission(context, (evaluate) =>
    evaluateSubmittedThenProjected(
      evaluate,
      submittedOptions(evaluation),
      evaluation.canonicalOptions,
    ),
  );
}

/** The group branch one locator call takes; each decides its own texts. */
function decideLocatorPermission(
  context: ToolContext,
  evaluation: LocatorEvaluation,
): PermissionDecision | undefined {
  if (NATIVE_FILE_PERMISSION_TOOL_IDS.has(evaluation.tool.id))
    return nativePathDecision(context, evaluation);

  return isBashTool(evaluation.tool)
    ? bashPermissionDecision(context, evaluation)
    : submittedPermissionDecision(context, evaluation);
}

function evaluateLocatorToolPermission(
  tool: Tool,
  args: SubmittedToolArguments,
  context: ToolContext,
): PermissionDecision | undefined {
  const evaluation = prepareLocatorEvaluation(tool, args, context);
  const decision = decideLocatorPermission(context, evaluation);

  return evaluateCanonicalReadPermission(context, evaluation, decision);
}

/**
 * Preview the permission decision for a schema-valid tool call without
 * recording activity or executing the tool.
 */
export function previewToolPermission(
  tool: Tool,
  args: SubmittedToolArguments,
  context: ToolContext,
): boolean {
  // The `read-only` ceiling refuses before anything else, exactly as in
  // `runTool`, so no caller plans a call the attempt cannot make.
  if (readOnlyCeiling(context, tool, args) !== undefined) return false;

  // A preview is synchronous: it cannot resolve an ssh destination, and the
  // allow must be decided on the resolved locator, so it fails closed.
  if (isSshRead(tool, args) || isSshBash(tool, args)) return false;

  return evaluateToolPermission(tool, args, context)?.decision === 'allow';
}

/**
 * Execute a tool end-to-end: absent-identity fail-closed (D4), input
 * validation against the tool's own schema (2.2), the timeout wrapper (D6),
 * failure-to-structured-error (never throws), and result truncation. Never
 * throws — always resolves to a `ToolResult` the run loop can persist/stream.
 */
export async function runTool(
  tool: Tool,
  // eslint-disable-next-line anti-slop/no-unknown-parameters -- validated by `admitToolCall`'s own `safeParseArgs(tool.inputSchema, args)` call, reached via the very first statement of this function's body.
  args: unknown,
  context: ToolContext | undefined,
  callTimeoutSeconds: number,
  /**
   * Fired after identity/schema checks and the permission decision, before any
   * executor dispatch. The run wrapper records the trusted decision durably and
   * only then emits `tool.started` for an allowed call. Direct callers that
   * omit it still cannot bypass the gate: the decision is evaluated here
   * regardless, and an absent trusted policy rejects.
   */
  onAdmitted?: (decision: PermissionDecision) => void | Promise<void>,
): Promise<ToolResult> {
  const admission = admitToolCall(tool, args, context, callTimeoutSeconds);

  if ('result' in admission) return admission.result;
  const { context: validContext, args: validArgs, submittedArgs } = admission;
  // The `read-only` ceiling runs right after argument validation: a rejected
  // call resolves no SSH destination, asks for no grep scope, and evaluates no
  // permission group. It records the same decision path as a policy reject.
  const ceiling = readOnlyCeiling(validContext, tool, submittedArgs);

  if (ceiling !== undefined) {
    if (onAdmitted !== undefined) await onAdmitted(ceiling);

    return permissionDeniedResult(ceiling.reason);
  }

  // Any other call keeps the synchronous permission path; an `ssh://` read or
  // `bash` cwd must resolve its destination first, so only those await.
  const pendingSsh = admitSshCall(tool, submittedArgs, validContext);
  const ssh = pendingSsh === undefined ? NO_SSH : await pendingSsh;

  if (ssh.kind === 'refused') return ssh.result;

  // Policy is not asked for a scope this process cannot search.
  if (tool.id === 'grep') {
    const scope = refuseUnsearchableGrepScopes(submittedArgs, validContext);

    if (scope !== undefined) return scope;
  }

  const decision =
    ssh.kind === 'decided'
      ? ssh.decision
      : evaluateToolPermission(tool, submittedArgs, validContext);

  if (decision === undefined) return permissionDeniedResult('no_allow');

  if (onAdmitted !== undefined) await onAdmitted(decision);

  if (decision.decision === 'reject')
    return permissionDeniedResult(decision.reason);

  return executeAdmittedTool(
    tool,
    validArgs,
    ssh.kind === 'decided' ? ssh.context : validContext,
    callTimeoutSeconds,
  );
}

type AdmittedArguments = {
  readonly args: UnknownRecord;
  readonly submittedArgs: SubmittedToolArguments;
};

function invalidToolArguments(tool: Tool): ToolResult {
  return {
    status: 'error',
    type: 'invalid_input',
    message: `Invalid arguments for tool "${tool.id}".`,
  };
}

function parseToolArguments(
  tool: Tool,
  args: SubmittedToolArguments,
): AdmittedArguments | ToolResult {
  const parsed = safeParseArgs(tool.inputSchema, args);

  if (!parsed.success || !isRecord(parsed.data)) {
    return invalidToolArguments(tool);
  }

  return { args: parsed.data, submittedArgs: args };
}

/**
 * The D4/D6 fail-closed guards (resolvable identity, not already cancelled,
 * a trusted timeout) plus schema validation (2.2), run before anything is
 * executed. Returns the narrowed context and validated args to proceed with,
 * or the `ToolResult` to return immediately.
 */
function admitToolCall(
  tool: Tool,
  // eslint-disable-next-line anti-slop/no-unknown-parameters -- validated via `safeParseArgs(tool.inputSchema, args)` a few statements down, after three unrelated guard checks (identity, abort, timeout) that must run first; genuinely validated, just not as this function's *first* statement, which the structural exemption doesn't cover.
  args: unknown,
  context: ToolContext | undefined,
  callTimeoutSeconds: number,
):
  | {
      context: ToolContext;
      args: UnknownRecord;
      submittedArgs: SubmittedToolArguments;
    }
  | { result: ToolResult } {
  if (!context?.userId) {
    // Defensive: the run loop always resolves an owner before offering
    // tools. A call with no resolvable identity must fail closed — no reads.
    return {
      result: {
        status: 'error',
        type: 'no_context',
        message: 'Tool execution requires a resolvable run owner.',
      },
    };
  }

  if (context.abortSignal?.aborted) {
    return { result: cancelledBeforeExecution(tool.id) };
  }

  if (!hasValidTrustedTimeout(tool.timeoutSeconds, callTimeoutSeconds)) {
    return { result: refusalResult(tool.id) };
  }

  if (!isRecord(args)) {
    return { result: invalidToolArguments(tool) };
  }

  const parsed = parseToolArguments(tool, args);

  if ('status' in parsed) return { result: parsed };

  return { context, ...parsed };
}
