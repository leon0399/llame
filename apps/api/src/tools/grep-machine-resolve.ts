import {
  FS_STAT_METHOD,
  MachineProtocolError,
} from '@workspace/machine-protocol';
import {
  normalizeHostScope,
  splitGrepScope,
  type GrepScope,
} from '@workspace/native-file-tools';

import type { MachineConnector } from '../machines/machine-connector.service';
import {
  MACHINE_NAME_PATTERN,
  parseMachineLocator,
} from '../machines/machine-locator';
import { readFsStatResult } from '../machines/machine-results';
import { type GrepReadAdmission } from './grep-admission';
import {
  invalidPathResult,
  machineUnsupportedResult,
  unsupportedGlobResult,
  type GrepToolError,
} from './grep-results';
import {
  MACHINE_FILE_BUDGET_MS,
  machineCallEnvelope,
  machineConnector,
  machineNotFoundResult,
} from './machine-call';
import { admitMachineFile, machineScopeLocator } from './grep-machine-wire';
import { machineGrepFailure } from './grep-machine-failure';
import { type ToolContext } from './types';
import type { MachineGrepScope, MachineScopeRequest } from './grep-machine';

const NO_PATH_MESSAGE =
  'A machine:// scope must name a Machine and an absolute path.';

const BAD_NAME_MESSAGE =
  'A machine:// scope must name a Machine as [a-z0-9-], up to 63 characters.';

const BAD_PATH_MESSAGE = 'The Machine scope path is invalid.';
const NOT_FOUND_MESSAGE = 'The target does not exist.';

type MachineScopeResolution =
  | { readonly machine: MachineGrepScope }
  | { readonly result: GrepToolError };

type ExactPathVerdict =
  | { readonly kind: 'walk'; readonly singleFile: boolean }
  | { readonly kind: 'refused' }
  | { readonly result: GrepToolError };

type ExactPathProbe = {
  readonly context: ToolContext;
  readonly connector: MachineConnector;
  readonly scope: MachineGrepScope;
  readonly admission: GrepReadAdmission;
  readonly deadlineAt: number;
};

export function isMachineGrepScope(
  scope: GrepScope | MachineGrepScope,
): scope is MachineGrepScope {
  return !('port' in scope);
}

export async function resolveMachineScope(
  request: MachineScopeRequest,
): Promise<MachineScopeResolution> {
  const { context, scope, index, admission, deadlineAt } = request;
  const parsed = machineScopeOf(scope, index);

  if ('status' in parsed) return { result: parsed };

  return resolveParsedMachineScope(context, parsed, admission, deadlineAt);
}

export async function resolveParsedMachineScope(
  context: ToolContext,
  scope: MachineGrepScope,
  admission: GrepReadAdmission,
  deadlineAt: number,
): Promise<MachineScopeResolution> {
  const connector = machineConnector(context);

  if (connector === undefined) return { result: machineUnsupportedResult() };

  if (!connector.isConfigured(scope.name))
    return { result: machineNotFoundResult(scope.name) };

  const verdict = await exactPathVerdict({
    context,
    connector,
    scope,
    admission,
    deadlineAt,
  });

  if ('result' in verdict) return { result: verdict.result };

  if (verdict.kind === 'refused')
    return { result: machinePathNotFoundResult() };

  return {
    machine: verdict.singleFile ? { ...scope, singleFile: true } : scope,
  };
}

function machinePathNotFoundResult(): GrepToolError {
  return { status: 'error', type: 'not_found', message: NOT_FOUND_MESSAGE };
}

async function exactPathVerdict(
  probe: ExactPathProbe,
): Promise<ExactPathVerdict> {
  const { scope } = probe;

  if (scope.globSuffix !== undefined)
    return { kind: 'walk', singleFile: false };

  const locator = machineScopeLocator(scope, '');

  if (locator === undefined) return { kind: 'walk', singleFile: false };

  const budgetMs = Math.min(
    probe.deadlineAt - Date.now(),
    MACHINE_FILE_BUDGET_MS,
  );

  if (budgetMs <= 0) return { kind: 'walk', singleFile: false };

  try {
    const answer = readFsStatResult(
      await probe.connector.request(
        scope.name,
        FS_STAT_METHOD,
        {
          envelope: machineCallEnvelope(probe.context, budgetMs),
          path: scope.path,
        },
        { signal: probe.context.abortSignal },
      ),
    );

    if (answer === undefined || answer.kind !== 'file' || answer.isLink)
      return { kind: 'walk', singleFile: false };

    if (scope.endsWithSeparator) return { kind: 'refused' };

    return admitMachineFile(probe.admission, scope, '', locator)
      ? { kind: 'walk', singleFile: true }
      : { kind: 'refused' };
  } catch (error) {
    if (
      error instanceof MachineProtocolError &&
      error.code === 'budget_exhausted'
    )
      return { kind: 'walk', singleFile: false };

    return { result: machineGrepFailure(scope.name, error) };
  }
}

export function machineScopeOf(
  scope: string,
  index: number,
): MachineGrepScope | GrepToolError {
  const rest = scope.slice('machine://'.length);
  const separator = rest.indexOf('/');

  if (separator < 0) return invalidPathResult(NO_PATH_MESSAGE);

  const name = rest.slice(0, separator).toLowerCase();

  if (!MACHINE_NAME_PATTERN.test(name))
    return invalidPathResult(BAD_NAME_MESSAGE);

  const split = splitGrepScope(rest.slice(separator));

  if ('error' in split) return unsupportedGlobResult(split.operator);

  const parsed = parseMachineLocator(
    `machine://${name}${split.prefix.replaceAll(':', '%3A')}`,
  );

  if (parsed.kind !== 'path') return invalidPathResult(BAD_PATH_MESSAGE);

  const path =
    parsed.path !== '/' && parsed.path.endsWith('/')
      ? parsed.path.slice(0, -1)
      : parsed.path;

  return {
    index,
    name,
    path: normalizeHostScope(path),
    globSuffix: split.globSuffix,
    endsWithSeparator: split.endsWithSeparator,
  };
}
