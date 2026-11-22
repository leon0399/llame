/**
 * The `machine://` branch of the native file tools: reads, both listing forms,
 * and the mutations. A target on another Machine runs through
 * `MachineConnector`; a target on `machines.local` completes the identity
 * check with this process's own daemon and then runs the existing host code in
 * process (design D8). Every reported path is a canonical Machine locator, so
 * a host path never crosses back to the model, and a Machine operation never
 * binds the Run to the local executor.
 */

import {
  type JsonValue,
  type RequestEnvelope,
} from '@workspace/machine-protocol';
import {
  formatMachineLocator,
  isMachineLocator,
  machinePrefix,
  parseMachineLocator,
  type MachineLocator,
} from '../machines/machine-locator';
import { readRootsListResult } from '../machines/machine-results';
import { type MachineConnector } from '../machines/machine-connector.service';
import { boundMachineRoots } from '../machines/machines-status';
import {
  MACHINE_FILE_BUDGET_MS,
  machineBudgetMs,
  machineCallEnvelope,
  machineConnector,
  machineNotFoundResult,
  machineReadResult,
  machineUnusableResult,
  runMachineMutation,
} from './machine-call';
import { configuredMachines, listingResult } from './machine-listing';
import { type ToolContext, type ToolResult } from './types';
import {
  createFile,
  editFile,
  readFile,
  replaceFile,
} from '@workspace/native-file-tools';
import { NativeFilesRepository } from '../runs/native-files-repository';
import { RunEventsRepository } from '../runs/runs-repository';
import { readMachinePath } from './machine-file-reads';
import {
  canonicalizeMachineResult,
  machinePathLocator,
  readFsMutateResult,
  type MachinePath,
} from './machine-file-results';
import { verifyLocalMachine } from './local-machine';
import { resolveMachinePath, type MachineTarget } from './workspace-path';

/** The three native calls a Machine locator can address. */
export type MachineFileCall =
  | { readonly operation: 'read'; readonly input: { readonly path: string } }
  | {
      readonly operation: 'edit';
      readonly input: {
        readonly path: string;
        readonly oldText: string;
        readonly newText: string;
      };
    }
  | {
      readonly operation: 'write';
      readonly input: {
        readonly path: string;
        readonly content: string;
        readonly replace?: boolean;
      };
    };

/**
 * One native call whose path is a `machine://` locator. `submitted` is the
 * text the model wrote, which is the key an image read is held under; the
 * locator itself is split into its Machine name, absolute path, and selector.
 */
export function executeMachineNative(
  context: ToolContext,
  call: MachineFileCall,
  submitted: string,
): Promise<ToolResult> {
  const connector = machineConnector(context);

  if (connector === undefined) return Promise.resolve(unknownSchemeResult());
  const locator = parseMachineLocator(call.input.path);

  if (locator.kind === 'invalid')
    return Promise.resolve({
      status: 'error',
      type: 'invalid_path',
      message: locator.message,
    });

  if (locator.kind !== 'path')
    return call.operation === 'read'
      ? machineListing(context, locator)
      : Promise.resolve(listingMutationResult());

  if (call.operation !== 'read' && locator.selector !== undefined)
    return Promise.resolve(selectorOnMutationResult());

  // This process hosts the named Machine: serve the call in process, so a
  // local target never spends a daemon request beyond the identity check.
  const target = resolveMachinePath(call.input.path, {
    workspaceRoot: context.workspaceRoot?.current(),
    defaultMachine: context.defaultMachine,
    localMachine: context.localMachine,
  });

  if (target.kind === 'machine' && target.local)
    return executeLocalNative(context, call, submitted, target);

  return call.operation === 'read'
    ? readMachinePath(context, connector, locator, submitted)
    : mutateMachinePath(context, call, locator);
}

/** The same call with one path replaced; the caller decided it differs. */
export function rewriteNativeCallPath(
  call: MachineFileCall,
  path: string,
): MachineFileCall {
  if (call.operation === 'read') return { operation: 'read', input: { path } };

  if (call.operation === 'edit')
    return { operation: 'edit', input: { ...call.input, path } };

  return { operation: 'write', input: { ...call.input, path } };
}

type HostMutationCall = Exclude<
  MachineFileCall,
  { readonly operation: 'read' }
>;

let nativeMutations: Promise<void> = Promise.resolve();

/** One host mutation at a time, whatever scheme resolved the target. */
export function serializeNativeMutation(
  operation: () => Promise<ToolResult>,
): Promise<ToolResult> {
  const pending = nativeMutations.then(operation);

  nativeMutations = pending.then(
    () => undefined,
    () => undefined,
  );

  return pending;
}

/** The locator a host result reports, and how each host path becomes one. */
type ReportedNativePath = {
  readonly locator: string;
  readonly reportPath: (hostPath: string) => string;
  /** The submitted path was a `machine://` locator, so its host path is
   *  decoded and its selector is already split off. */
  readonly decoded?: { readonly selector?: string };
};

/**
 * One call on this process's Machine: the identity-checked handshake first,
 * then the existing host code with the decoded absolute path. A failed
 * handshake is the result and the operation never runs. Every reported path
 * is rewritten to the Machine locator, while the open still uses `target.path`.
 */
export async function executeLocalNative(
  context: ToolContext,
  call: MachineFileCall,
  submitted: string,
  target: MachineTarget,
): Promise<ToolResult> {
  const refusal = await verifyLocalMachine(context);

  if (refusal !== undefined) return refusal;

  // A `machine://` read takes the name the parser decoded, so a colon the
  // path still holds is part of the file name. A bare host path keeps the
  // host grammar, where the literal-path probe decides what a suffix means;
  // and a mutation's selector was already refused by the Machine grammar.
  const decoded = call.operation === 'read' && isMachineLocator(submitted);

  const path =
    decoded || target.selector === undefined
      ? target.path
      : `${target.path}:${target.selector}`;

  const hostCall = rewriteNativeCallPath(call, path);

  const reported: ReportedNativePath = {
    locator: target.locator,
    reportPath: (hostPath) =>
      formatMachineLocator(target.name, hostPath) ?? hostPath,
    ...(decoded && {
      decoded: {
        ...(target.selector !== undefined && { selector: target.selector }),
      },
    }),
  };

  const operation = () =>
    executeNativeBound(context, hostCall, submitted, reported);

  return call.operation === 'read'
    ? operation()
    : serializeNativeMutation(operation);
}

/** The identity one in-process host call fences under. */
type NativeBoundContext = {
  readonly runId: string;
  readonly localMachine: string;
  readonly toolCallId: string;
  readonly userId: string;
};

/**
 * The identity an in-process host call needs, or the refusal a worker with no
 * native authority records instead of running it.
 */
function nativeBoundContext(
  context: ToolContext,
): NativeBoundContext | ToolResult {
  const { runId, localMachine, toolCallId, userId } = context;

  if (!runId || !localMachine || !toolCallId)
    return {
      status: 'error',
      type: 'executor_unavailable',
      message: 'Native host authority is unavailable.',
    };

  return { runId, localMachine, toolCallId, userId };
}

/**
 * The durable pre-effect fence for one in-process host call: a call already
 * begun returns its prior result, so the effect never runs twice.
 */
function beginNativeCall(
  context: ToolContext,
  call: MachineFileCall,
  reported: ReportedNativePath | undefined,
  bound: NativeBoundContext,
): Promise<ToolResult | undefined> {
  return context.tenantDb.runAs(bound.userId, (db) =>
    new NativeFilesRepository(db).begin({
      runId: bound.runId,
      userId: bound.userId,
      fence: { bound: true, executorId: bound.localMachine },
      deliverySequence: context.nativeDeliverySequence,
      attemptId: context.attemptId,
      toolCallId: bound.toolCallId,
      operation: call.operation,
      path: reported?.locator ?? call.input.path,
    }),
  );
}

/** The exact `native.result` a mutation's effect already settled on. */
async function commitNativeResult(
  context: ToolContext,
  result: ToolResult,
  bound: NativeBoundContext,
): Promise<void> {
  await context.tenantDb.runAs(bound.userId, async (db) => {
    await new RunEventsRepository(db).append(bound.runId, 'native.result', {
      toolCallId: bound.toolCallId,
      result,
    });
  });
}

/**
 * The durable pre-effect fence for one in-process host call. `submitted` is
 * the path as the model wrote it; an image read is held in the attempt's
 * memory under it.
 */
async function executeNativeBound(
  context: ToolContext,
  call: MachineFileCall,
  submitted: string,
  reported?: ReportedNativePath,
): Promise<ToolResult> {
  const bound = nativeBoundContext(context);

  if ('status' in bound) return bound;
  context.abortSignal?.throwIfAborted();

  const prior = await beginNativeCall(context, call, reported, bound);

  if (prior) return prior;
  context.abortSignal?.throwIfAborted();

  const result = await performNative(call, context, submitted, reported);

  if (call.operation !== 'read')
    await commitNativeResult(context, result, bound);

  return result;
}

function performNative(
  call: MachineFileCall,
  context: ToolContext,
  submitted: string,
  reported?: ReportedNativePath,
): Promise<ToolResult> {
  const reportPath = reported?.reportPath;
  const decoded = reported?.decoded;

  return call.operation === 'read'
    ? readFile(
        call.input,
        context.abortSignal,
        context.media?.readMedia(submitted, context.toolCallId),
        {
          ...(reportPath !== undefined && { reportPath }),
          ...(decoded !== undefined && { decoded }),
        },
      )
    : performMutation(call, call.input.path, {
        signal: context.abortSignal,
        reportPath,
      });
}

/** The host path is the argument for an absolute path and the resolved target
 *  for a scheme, so the mutation itself is the same call either way. */
export function performMutation(
  call: HostMutationCall,
  hostPath: string,
  runtime: {
    signal?: AbortSignal;
    displayPath?: string;
    reserveCodeUnits?: number;
    reportPath?: (hostPath: string) => string;
  },
): Promise<ToolResult> {
  if (call.operation === 'edit')
    return editFile({ ...call.input, path: hostPath }, runtime.signal, {
      displayPath: runtime.displayPath,
      reserveCodeUnits: runtime.reserveCodeUnits,
      reportPath: runtime.reportPath,
    });
  const input = { path: hostPath, content: call.input.content };

  const options = {
    displayPath: runtime.displayPath,
    reserveCodeUnits: runtime.reserveCodeUnits,
    reportPath: runtime.reportPath,
  };

  return call.input.replace === true
    ? replaceFile(input, runtime.signal, options)
    : createFile(input, runtime.signal, options);
}

function unknownSchemeResult(): ToolResult {
  return {
    status: 'error',
    type: 'invalid_path',
    message: 'This path scheme is not available.',
  };
}

function listingMutationResult(): ToolResult {
  return {
    status: 'error',
    type: 'unsupported_operation',
    message: 'A Machine listing is read-only; edit and write cannot target it.',
  };
}

function selectorOnMutationResult(): ToolResult {
  return {
    status: 'error',
    type: 'invalid_selector',
    message: 'A line selector cannot be used with edit or write.',
  };
}

/**
 * A bare `machine://` lists every configured Machine with its status, and
 * `machine://<name>` lists that Machine's registered roots. Both are reads:
 * the mutation forms are refused before any request.
 */
function machineListing(
  context: ToolContext,
  locator: Extract<MachineLocator, { kind: 'list' | 'roots' }>,
): Promise<ToolResult> {
  const connector = machineConnector(context);

  if (connector === undefined) return Promise.resolve(unknownSchemeResult());

  if (locator.kind === 'list') return configuredMachines(context, connector);

  if (!connector.isConfigured(locator.name))
    return Promise.resolve(machineNotFoundResult(locator.name));
  const name = locator.name;

  return machineReadResult(name, async () => {
    const raw = await connector.request(
      name,
      'roots.list',
      {
        envelope: machineCallEnvelope(
          context,
          machineBudgetMs(context, MACHINE_FILE_BUDGET_MS),
        ),
      },
      { signal: context.abortSignal },
    );

    const result = readRootsListResult(raw);

    if (result === undefined) return machineUnusableResult(name);
    const roots = boundMachineRoots(result.roots);

    const lines = roots.map((root) => {
      const location =
        formatMachineLocator(name, root) ?? `${machinePrefix(name)}${root}`;

      return `- ${location}${root.endsWith('/') ? '' : '/'}`;
    });

    return listingResult(
      machinePrefix(name),
      lines.length === 0 ? ['(no registered roots)'] : lines,
    );
  });
}

async function mutateMachinePath(
  context: ToolContext,
  call: Exclude<MachineFileCall, { operation: 'read' }>,
  machine: MachinePath,
): Promise<ToolResult> {
  const connector = machineConnector(context);

  if (connector === undefined) return unknownSchemeResult();

  if (!connector.isConfigured(machine.name))
    return machineNotFoundResult(machine.name);

  const envelope = machineCallEnvelope(
    context,
    machineBudgetMs(context, MACHINE_FILE_BUDGET_MS),
  );

  return runMachineMutation(
    context,
    {
      name: machine.name,
      operation: call.operation,
      locator: machinePathLocator(machine),
    },
    async () => {
      const raw = await requestMachineMutation(context, connector, call, {
        machine,
        envelope,
      });

      const result = readFsMutateResult(
        raw,
        call.operation === 'edit' ? call.input : undefined,
      );

      return result === undefined
        ? machineUnusableResult(machine.name)
        : canonicalizeMachineResult(machine, result);
    },
  );
}

/** The addressing and budget one Machine mutation request carries. */
type MachineMutationRequest = {
  readonly machine: MachinePath;
  readonly envelope: RequestEnvelope;
};

/** One `fs.edit` or `fs.write` request, whichever the machine call asked for. */
function requestMachineMutation(
  context: ToolContext,
  connector: MachineConnector,
  call: Exclude<MachineFileCall, { operation: 'read' }>,
  request: MachineMutationRequest,
): Promise<JsonValue> {
  const { machine, envelope } = request;
  const options = { displayPrefix: machinePrefix(machine.name) };

  return call.operation === 'edit'
    ? connector.request(
        machine.name,
        'fs.edit',
        {
          envelope,
          path: machine.path,
          options,
          oldText: call.input.oldText,
          newText: call.input.newText,
        },
        { signal: context.abortSignal },
      )
    : connector.request(
        machine.name,
        'fs.write',
        {
          envelope,
          path: machine.path,
          options,
          content: call.input.content,
          ...(call.input.replace === true && { replace: true }),
        },
        { signal: context.abortSignal },
      );
}
