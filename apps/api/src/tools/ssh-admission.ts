/**
 * The asynchronous two-pass admission for an `ssh://` read (ssh-locator design
 * D3). The locator grammar is checked first, then the read group's rejects
 * against the submitted text with the selector removed — a match refuses
 * before anything resolves, so a rejected locator runs no operator
 * `Match exec`. Only then does the destination resolve through `ssh -G`, and
 * the full group is evaluated once more against the resolved locator
 * `ssh://<user>@<host>:<port><decoded path>`, so an alias cannot go around an
 * address reject and an allow names the host the connection actually reaches.
 *
 * Resolution runs in `bypass` mode too, because execution binds to it. The
 * resolved user, host, and port travel to execution on the trusted context;
 * they are never model supplied. The synchronous preview cannot resolve, so it
 * treats every `ssh://` read as refused and no caller plans one.
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
export type SshReadAdmission =
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

/** Is this call a `read` of an `ssh://` locator? */
export function isSshRead(
  tool: Tool,
  args: UnknownRecord,
): args is SshReadArguments {
  return (
    tool.id === 'read' && isString(args['path']) && isSshLocator(args['path'])
  );
}

function cancelledRead(): ToolResult {
  return {
    status: 'error',
    type: 'cancelled',
    message: 'Tool "read" was cancelled.',
  };
}

/** The read group's decision for one locator text. */
function evaluateSshRead(
  context: ToolContext,
  path: string,
): PermissionDecision | undefined {
  return admitPermission(context, (policy) =>
    evaluatePermission(policy, { toolId: 'read', args: { path } }),
  );
}

/**
 * Resolve one parsed destination, or the refusal the call returns. A deadline
 * or configuration failure is `ssh_unavailable`; cancellation is itself.
 */
async function resolveSshRead(
  client: NonNullable<ToolContext['sshClient']>,
  parsed: SshPathLocator,
  signal: AbortSignal | undefined,
): Promise<SshResolvedDestination | SshReadAdmission> {
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
    return { kind: 'refused', result: cancelledRead() };
  if (resolution.outcome === 'failed')
    return { kind: 'refused', result: sshUnavailableResult(resolution.reason) };
  return resolution.destination;
}

/** The execution context carrying the resolved binding for this call. */
function boundContext(
  context: ToolContext,
  parsed: SshPathLocator,
  resolved: SshResolvedDestination,
  locator: string,
): ToolContext {
  return {
    ...context,
    sshBinding: {
      destination: parsed.destination.host,
      user: resolved.user,
      hostname: resolved.host,
      port: resolved.port,
      locator,
    },
  };
}

/** Judge the resolved locator and hand execution its binding. */
function decideResolvedSshRead(
  context: ToolContext,
  parsed: SshPathLocator,
  resolved: SshResolvedDestination,
  submitted: string,
): SshReadAdmission {
  const locator = formatSshLocator(resolved, parsed.path);
  if (locator === undefined)
    return { kind: 'refused', result: sshUnavailableResult('config') };
  const decision = evaluateSshRead(context, locator);
  if (decision === undefined) return { kind: 'none' };
  if (locator !== submitted)
    context.onDerivedDecision?.({ kind: 'canonical', url: locator, decision });
  if (decision.decision === 'reject')
    return { kind: 'decided', decision, context };
  return {
    kind: 'decided',
    decision,
    context: boundContext(context, parsed, resolved, locator),
  };
}

export async function admitSshRead(
  args: SshReadArguments,
  context: ToolContext,
): Promise<SshReadAdmission> {
  const client = context.sshClient;
  // Without the section the scheme stays unknown: the normal path evaluates
  // policy and execution refuses it, and there is nothing to resolve with. A
  // missing trusted policy denies the call before any process, exactly as the
  // synchronous path does.
  if (client === undefined || context.permissionPolicy === undefined)
    return { kind: 'none' };

  const parsed = parseSshLocator(args.path);
  if (parsed.kind === 'help') return { kind: 'none' };
  if (parsed.kind === 'invalid')
    return {
      kind: 'refused',
      result: {
        status: 'error',
        type: 'invalid_path',
        message: parsed.message,
      },
    };

  const submitted = withoutReadSelector(args.path);
  const submittedDecision = evaluateSshRead(context, submitted);
  if (
    submittedDecision !== undefined &&
    submittedDecision.decision === 'reject' &&
    submittedDecision.reason !== 'no_allow'
  ) {
    return { kind: 'decided', decision: submittedDecision, context };
  }

  const resolved = await resolveSshRead(client, parsed, context.abortSignal);
  if ('kind' in resolved) return resolved;
  return decideResolvedSshRead(context, parsed, resolved, submitted);
}
