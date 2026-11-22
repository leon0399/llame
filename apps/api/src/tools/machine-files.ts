/**
 * The `machine://` branch of the native file tools: reads, both listing forms,
 * and the mutations. Every target runs through `MachineConnector`, this
 * process's own Machine included: design D8 makes the host an ordinary
 * Machine, so its daemon enforces the registered roots and there is no
 * in-process file branch left to fall back on. Every reported path is a
 * canonical Machine locator, so a host path never crosses back to the model,
 * and a file operation never binds the Run to a worker (design D15).
 */

import {
  type JsonValue,
  type RequestEnvelope,
} from '@workspace/machine-protocol';
import {
  formatMachineLocator,
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
  editFile,
  createFile,
  replaceFile,
} from '@workspace/native-file-tools';
import { readMachinePath } from './machine-file-reads';
import {
  canonicalizeMachineResult,
  machinePathLocator,
  readFsMutateResult,
  type MachinePath,
} from './machine-file-results';

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

/** One Knowledge mutation at a time, so aliases of the same file cannot
 *  interleave. Machine mutations are serialized by their connector. */
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

/** The resolved host path is the argument, so a Knowledge mutation is the
 *  same call whatever locator named the target. */
export function performMutation(
  call: HostMutationCall,
  hostPath: string,
  runtime: {
    signal?: AbortSignal;
    displayPath?: string;
    reserveCodeUnits?: number;
  },
): Promise<ToolResult> {
  const options = {
    displayPath: runtime.displayPath,
    reserveCodeUnits: runtime.reserveCodeUnits,
  };

  if (call.operation === 'edit')
    return editFile({ ...call.input, path: hostPath }, runtime.signal, options);
  const input = { path: hostPath, content: call.input.content };

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
