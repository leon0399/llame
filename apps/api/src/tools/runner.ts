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
  evaluateSubmittedThenProjected,
  readOnlyCeiling,
} from './permissions/admit';
import { isBashCommandField } from './permissions/bash-command-field';
import { declaredStringProperties } from './permissions/declared-fields';
import {
  nativeFileProjection,
  withoutReadSelector,
} from './permissions/locator-projection';
import { permissionDeniedResult } from './permissions/messages';
import {
  canonicalMachineLocator,
  isWorkspaceRelative,
  mapToWorkspaceHost,
  resolveWorkspacePath,
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

type WorkspaceProjection = {
  readonly args: SubmittedToolArguments;
  readonly changed: boolean;
};

function projectWorkspaceArguments(
  tool: Tool,
  args: SubmittedToolArguments,
  root: string | undefined,
): WorkspaceProjection {
  if (isNativeFileTool(tool)) return projectNativeFileArguments(args, root);

  if (isBashTool(tool)) return projectBashArguments(args, root);

  return { args, changed: false };
}

/** The same arguments with one field replaced; the caller decided it differs. */
function projectedField(
  args: SubmittedToolArguments,
  field: 'path' | 'cwd',
  value: string,
): WorkspaceProjection {
  return { args: { ...args, [field]: value }, changed: true };
}

/**
 * A native read's `path`: a Workspace-relative one resolves under the root,
 * and a bare absolute one inside a Machine Workspace addresses the Machine, so
 * policy must see the address the call will actually reach.
 */
function projectNativeFileArguments(
  args: SubmittedToolArguments,
  root: string | undefined,
): WorkspaceProjection {
  const path = args.path;

  if (!isString(path) || root === undefined) return { args, changed: false };

  if (isWorkspaceRelative(path))
    return projectedField(args, 'path', resolveWorkspacePath(root, path));
  const mapped = mapToWorkspaceHost(root, path);

  return mapped === path
    ? { args, changed: false }
    : projectedField(args, 'path', mapped);
}

/**
 * `bash`'s `cwd`: a `machine://` locator is canonicalized as written, an
 * omitted one defaults to the Workspace root, and a Workspace-relative or bare
 * absolute one resolves the way a native path does.
 */
function projectBashArguments(
  args: SubmittedToolArguments,
  root: string | undefined,
): WorkspaceProjection {
  const cwd = args.cwd;

  if (isString(cwd) && isMachineLocator(cwd)) {
    const canonical = canonicalMachineLocator(cwd);

    return canonical === cwd
      ? { args, changed: false }
      : projectedField(args, 'cwd', canonical);
  }

  if (root === undefined) return { args, changed: false };

  if (cwd === undefined) return projectedField(args, 'cwd', root);

  if (isString(cwd) && isWorkspaceRelative(cwd))
    return projectedField(args, 'cwd', resolveWorkspacePath(root, cwd));

  if (!isString(cwd)) return { args, changed: false };
  const mapped = mapToWorkspaceHost(root, cwd);

  return mapped === cwd
    ? { args, changed: false }
    : projectedField(args, 'cwd', mapped);
}

function evaluateCanonicalReadPermission(
  context: ToolContext,
  tool: Tool,
  workspace: WorkspaceProjection,
  projectFieldValue: (field: string, value: string) => string,
  options: EvaluatePermissionOptions,
  decision: PermissionDecision | undefined,
): PermissionDecision | undefined {
  const evaluatedPath =
    tool.id === 'read' && isString(workspace.args.path)
      ? projectFieldValue('path', workspace.args.path)
      : undefined;

  const canonicalPath = context.canonicalReadPath;

  if (
    canonicalPath === undefined ||
    evaluatedPath === undefined ||
    canonicalPath === evaluatedPath
  ) {
    return decision;
  }

  const canonicalDecision = admitPermission(context, (evaluate) =>
    evaluate({
      ...options,
      args: { path: canonicalPath },
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

function evaluateLocatorToolPermission(
  tool: Tool,
  args: SubmittedToolArguments,
  context: ToolContext,
): PermissionDecision | undefined {
  const root = context.workspaceRoot?.current();
  const workspace = projectWorkspaceArguments(tool, args, root);

  const options = {
    toolId: tool.id,
    args: workspace.args,
    isFlexibleWhitespaceField: (field: string) =>
      isBashCommandField(tool.id, field),
    validFields: mcpDeclaredStringFields(tool),
    projectFieldValue: nativeFileProjection(tool.id, root),
  };

  const submitted = {
    ...options,
    args,
    projectFieldValue:
      tool.id === 'read'
        ? (field: string, value: string) =>
            field === 'path' ? withoutReadSelector(value) : value
        : undefined,
  };

  const decision = admitPermission(context, (evaluate) =>
    workspace.changed
      ? evaluate(options)
      : evaluateSubmittedThenProjected(evaluate, submitted, options),
  );

  return evaluateCanonicalReadPermission(
    context,
    tool,
    workspace,
    options.projectFieldValue,
    options,
    decision,
  );
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
