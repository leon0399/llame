/**
 * The asynchronous two-pass admission for an `ssh://` locator (ssh-locator
 * design D3): `read`'s `path` and `bash`'s `cwd`. The locator grammar is
 * checked first, then the tool group's rejects against the submitted text with
 * the read selector removed — a match refuses before anything resolves, so a
 * rejected locator runs no operator `Match exec`. Only then does the
 * destination resolve through `ssh -G`, and the full group is evaluated once
 * more against the resolved locator `ssh://<user>@<host>:<port><decoded path>`,
 * so an alias cannot go around an address reject and an allow names the host
 * the connection actually reaches.
 *
 * Resolution runs in `bypass` mode too, because execution binds to it. The
 * resolved user, host, and port travel to execution on the trusted context;
 * they are never model supplied. The synchronous preview cannot resolve, so it
 * treats every `ssh://` call as refused and no caller plans one.
 */

import { isString, type UnknownRecord } from '@workspace/runtime-safety';

import {
  formatSshLocator,
  isSshLocator,
  parseSshLocator,
  type SshPathLocator,
} from '../ssh/ssh-locator';
import { type SshResolvedDestination } from '../ssh/ssh-client';
import { admitPermission } from './permissions/admit';
import { evaluatePermission } from './permissions/evaluator';
import { withoutReadSelector } from './permissions/locator-projection';
import { type PermissionDecision } from './permissions/types';
import { sshUnavailableResult } from './ssh-results';
import { type Tool, type ToolContext, type ToolResult } from './types';

/** What the runner does with this call after the `ssh://` admission step. */
export type SshAdmission =
  | { readonly kind: 'none' }
  | {
      readonly kind: 'decided';
      readonly decision: PermissionDecision;
      /** The context execution sees, carrying the resolved binding. */
      readonly context: ToolContext;
    }
  | { readonly kind: 'refused'; readonly result: ToolResult };

/** The submitted arguments of an `ssh://` read: only `path` decides. */
export type SshReadArguments = { readonly path: string };

/** The submitted arguments of an `ssh://` bash: only `cwd` decides. */
export type SshBashArguments = { readonly cwd: string };

/** Is this call a `read` of an `ssh://` locator? */
export function isSshRead(
  tool: Tool,
  args: UnknownRecord,
): args is SshReadArguments {
  return (
    tool.id === 'read' && isString(args['path']) && isSshLocator(args['path'])
  );
}

/** Is this call a `bash` with an `ssh://` working directory? */
export function isSshBash(
  tool: Tool,
  args: UnknownRecord,
): args is SshBashArguments {
  return (
    tool.id === 'bash' && isString(args['cwd']) && isSshLocator(args['cwd'])
  );
}

/** The tool group and argument field one locator call decides. */
type SshLocatorCall = {
  readonly toolId: 'read' | 'bash';
  readonly field: 'path' | 'cwd';
  readonly submitted: string;
  readonly parsed: SshPathLocator;
};

function cancelledResult(toolId: 'read' | 'bash'): ToolResult {
  return {
    status: 'error',
    type: 'cancelled',
    message: `Tool "${toolId}" was cancelled.`,
  };
}

function invalidPathResult(message: string): SshAdmission {
  return {
    kind: 'refused',
    result: { status: 'error', type: 'invalid_path', message },
  };
}

/** The group's decision for one locator text. */
function evaluateSshLocator(
  context: ToolContext,
  toolId: 'read' | 'bash',
  field: 'path' | 'cwd',
  value: string,
): PermissionDecision | undefined {
  return admitPermission(context, (policy) =>
    evaluatePermission(policy, { toolId, args: { [field]: value } }),
  );
}

/**
 * Resolve one parsed destination, or the refusal the call returns. A deadline
 * or configuration failure is `ssh_unavailable`; cancellation is itself.
 */
async function resolveSshDestination(
  client: NonNullable<ToolContext['sshClient']>,
  parsed: SshPathLocator,
  signal: AbortSignal | undefined,
  toolId: 'read' | 'bash',
): Promise<SshResolvedDestination | SshAdmission> {
  const resolution = await client.resolve({
    host: parsed.destination.host,
    ...(parsed.destination.user !== undefined && {
      user: parsed.destination.user,
    }),
    ...(parsed.destination.port !== undefined && {
      port: parsed.destination.port,
    }),
    ...(signal !== undefined && { signal }),
  });
  if (resolution.outcome === 'cancelled')
    return { kind: 'refused', result: cancelledResult(toolId) };
  if (resolution.outcome === 'failed')
    return { kind: 'refused', result: sshUnavailableResult(resolution.reason) };
  return resolution.destination;
}

/** The execution context carrying the resolved binding for this call. */
function boundContext(
  context: ToolContext,
  destination: string,
  resolved: SshResolvedDestination,
  locator: string,
): ToolContext {
  return {
    ...context,
    sshBinding: { ...resolved, destination, locator },
  };
}

/** Judge the resolved locator and hand execution its binding. */
function decideResolvedSsh(
  context: ToolContext,
  call: SshLocatorCall,
  resolved: SshResolvedDestination,
): SshAdmission {
  const locator = formatSshLocator(resolved, call.parsed.path);
  if (locator === undefined)
    return { kind: 'refused', result: sshUnavailableResult('config') };
  const decision = evaluateSshLocator(
    context,
    call.toolId,
    call.field,
    locator,
  );
  if (decision === undefined) return { kind: 'none' };
  if (locator !== call.submitted)
    context.onDerivedDecision?.({ kind: 'canonical', url: locator, decision });
  if (decision.decision === 'reject')
    return { kind: 'decided', decision, context };
  return {
    kind: 'decided',
    decision,
    context: boundContext(
      context,
      call.parsed.destination.host,
      resolved,
      locator,
    ),
  };
}

/** The two passes every resolved locator shares. */
async function admitSshLocator(
  call: SshLocatorCall,
  context: ToolContext,
  client: NonNullable<ToolContext['sshClient']>,
): Promise<SshAdmission> {
  const submittedDecision = evaluateSshLocator(
    context,
    call.toolId,
    call.field,
    call.submitted,
  );
  if (
    submittedDecision !== undefined &&
    submittedDecision.decision === 'reject' &&
    submittedDecision.reason !== 'no_allow'
  ) {
    return { kind: 'decided', decision: submittedDecision, context };
  }

  const resolved = await resolveSshDestination(
    client,
    call.parsed,
    context.abortSignal,
    call.toolId,
  );
  if ('kind' in resolved) return resolved;
  return decideResolvedSsh(context, call, resolved);
}

/** `read`'s admission: the locator without its selector is the submitted text. */
export async function admitSshRead(
  args: SshReadArguments,
  context: ToolContext,
): Promise<SshAdmission> {
  const client = context.sshClient;
  // Without the section the scheme stays unknown: the normal path evaluates
  // policy and execution refuses it, and there is nothing to resolve with. A
  // missing trusted policy denies the call before any process, exactly as the
  // synchronous path does.
  if (client === undefined || context.permissionPolicy === undefined)
    return { kind: 'none' };

  const parsed = parseSshLocator(args.path);
  // A bare locator is answered by the `ssh` dispatch, which owns the fixed
  // message; this layer leaves it to the normal path so an admitted `ssh://`
  // read stays fail-closed until that dispatch lands.
  if (parsed.kind === 'help') return { kind: 'none' };
  if (parsed.kind === 'invalid') return invalidPathResult(parsed.message);

  const submitted = withoutReadSelector(args.path);
  return admitSshLocator(
    { toolId: 'read', field: 'path', submitted, parsed },
    context,
    client,
  );
}

/**
 * `bash`'s admission: its `cwd` is one absolute locator without a read
 * selector, and the group matches that text, never the command.
 */
export async function admitSshBash(
  args: SshBashArguments,
  context: ToolContext,
): Promise<SshAdmission> {
  const client = context.sshClient;
  if (client === undefined || context.permissionPolicy === undefined)
    return { kind: 'none' };

  const parsed = parseSshLocator(args.cwd);
  if (parsed.kind === 'help')
    return invalidPathResult(
      'An ssh:// working directory needs an absolute path after the destination, like ssh://box/tmp.',
    );
  if (parsed.kind === 'invalid') return invalidPathResult(parsed.message);
  if (parsed.selector !== undefined)
    return invalidPathResult(
      'An ssh:// working directory is one absolute path without a selector.',
    );
  return admitSshLocator(
    { toolId: 'bash', field: 'cwd', submitted: args.cwd, parsed },
    context,
    client,
  );
}
