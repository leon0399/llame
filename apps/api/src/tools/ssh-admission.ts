/**
 * The asynchronous two-pass admission for an `ssh://` locator (ssh-locator
 * design D3): `read`'s `path` and `bash`'s `cwd`. The locator grammar is
 * checked first, then the tool group's rules against the submitted arguments
 * with that field replaced by the locator (for `read`, without its selector) —
 * a reject refuses before anything resolves, so a rejected locator runs no
 * operator `Match exec`. Only then does the destination resolve through
 * `ssh -G`, and the full group is evaluated once more against the resolved
 * locator `ssh://<user>@<host>:<port><decoded path>`, so an alias cannot go
 * around an address reject and an allow names the host the connection actually
 * reaches.
 *
 * `bash`'s other arguments stay visible to every rule: a `command` or `env`
 * reject matches the same text the remote shell runs. Its arguments are also
 * refused here, before the resolution, when the `env` entries are not data or
 * the command holds NUL, which `bash -s` drops.
 *
 * Resolution runs in `bypass` mode too, because execution binds to it. The
 * resolved user, host, and port travel to execution on the trusted context;
 * they are never model supplied. The synchronous preview cannot resolve, so it
 * treats every `ssh://` call as refused and no caller plans one.
 */

import { isString, type UnknownRecord } from '@workspace/runtime-safety';

import { managedEnvironmentCollision } from '@workspace/bash-executor';

import {
  formatSshLocator,
  isSshLocator,
  parseSshLocator,
  type SshPathLocator,
} from '../ssh/ssh-locator';
import { type SshResolvedDestination } from '../ssh/ssh-client';
import { admitPermission } from './permissions/admit';
import { withoutReadSelector } from './permissions/locator-projection';
import { type PermissionDecision } from './permissions/types';
import { sshUnavailableResult } from './ssh-results';
import { type Tool, type ToolContext, type ToolResult } from './types';

const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/u;

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

/**
 * The submitted arguments of an `ssh://` bash: `cwd` decides the locator, and
 * `command` and `env` stay visible to the permission rules as submitted.
 */
export type SshBashArguments = {
  readonly cwd: string;
  readonly command: string;
  readonly env?: Readonly<Record<string, string>>;
};

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
    tool.id === 'bash' &&
    isString(args['cwd']) &&
    isSshLocator(args['cwd']) &&
    isString(args['command'])
  );
}

/** The tool group and argument field one locator call decides. */
type SshLocatorCall = {
  readonly toolId: 'read' | 'bash';
  readonly field: 'path' | 'cwd';
  /** The submitted arguments, of which only the locator field is replaced. */
  readonly args: UnknownRecord;
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

function unavailableResult(message: string): SshAdmission {
  return {
    kind: 'refused',
    result: { status: 'error', type: 'unavailable', message },
  };
}

/**
 * The `env` and `command` refusal of an `ssh://` bash, before any process and
 * before the destination resolves. Each `env` key is an identifier, no value
 * holds NUL, and no entry replaces a managed base variable; the script exports
 * each entry as data. A command with NUL is refused because `bash -s` drops it,
 * so the command that runs would not be the text the rules matched.
 */
function refusedBashArguments(
  args: SshBashArguments,
): SshAdmission | undefined {
  if (args.command.includes('\0'))
    return {
      kind: 'refused',
      result: {
        status: 'error',
        type: 'invalid_input',
        message:
          'The command must not contain NUL: the remote shell drops it, so the command that would run is not the text the permission rules matched.',
      },
    };
  for (const [key, value] of Object.entries(args.env ?? {})) {
    if (!ENV_KEY_PATTERN.test(key))
      return unavailableResult(
        `Environment key ${JSON.stringify(key)} is not a valid name; an ssh:// bash environment key must match [A-Za-z_][A-Za-z0-9_]*.`,
      );
    if (value.includes('\0'))
      return unavailableResult(
        `Environment entry ${JSON.stringify(key)} must not contain NUL.`,
      );
  }
  const collision = managedEnvironmentCollision(args.env ?? {});
  return collision === undefined
    ? undefined
    : unavailableResult(
        `Environment variable ${collision} cannot replace a managed base variable.`,
      );
}

/**
 * The group's decision for the submitted arguments with the locator field
 * replaced. Rules see `command` and `env` as submitted, so a reject on either
 * cannot be arranged to miss a call an `ssh://` bash would run.
 */
function evaluateSshLocator(
  context: ToolContext,
  call: SshLocatorCall,
  value: string,
): PermissionDecision | undefined {
  return admitPermission(context, (evaluate) =>
    evaluate({
      toolId: call.toolId,
      args: { ...call.args, [call.field]: value },
    }),
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
  const decision = evaluateSshLocator(context, call, locator);
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
  const submittedDecision = evaluateSshLocator(context, call, call.submitted);
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
    { toolId: 'read', field: 'path', args, submitted, parsed },
    context,
    client,
  );
}

/**
 * `bash`'s admission: its `cwd` is one absolute locator without a read
 * selector. The group sees the submitted `command` and `env` too, on the
 * submitted and on the resolved locator, both before any process.
 */
export async function admitSshBash(
  args: SshBashArguments,
  context: ToolContext,
): Promise<SshAdmission> {
  const client = context.sshClient;
  if (client === undefined || context.permissionPolicy === undefined)
    return { kind: 'none' };

  const refusedArguments = refusedBashArguments(args);
  if (refusedArguments !== undefined) return refusedArguments;

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
    { toolId: 'bash', field: 'cwd', args, submitted: args.cwd, parsed },
    context,
    client,
  );
}

/**
 * The `ssh://` admission a call needs, or undefined for every other call, so
 * those keep the synchronous permission path without an extra await.
 */
export function admitSshCall(
  tool: Tool,
  args: UnknownRecord,
  context: ToolContext,
): Promise<SshAdmission> | undefined {
  if (isSshRead(tool, args)) return admitSshRead(args, context);
  if (isSshBash(tool, args)) return admitSshBash(args, context);
  return undefined;
}
