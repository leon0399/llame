import {
  MachineProtocolError,
  type FsGrepPassage,
  type FsGrepSuccess,
} from '@workspace/machine-protocol';
import {
  formatPassageLocator,
  type GrepPassage,
} from '@workspace/native-file-tools';

import {
  MachineIdentityMismatchError,
  MachineUnavailableError,
  MachineUpdateRequiredError,
} from '../machines/machine-session-errors';
import { type MachineGrepScope, type MachineGrepSearch } from './grep-machine';
import { type GrepReadAdmission } from './grep-admission';
import {
  machineIdentityMismatchResult,
  machineProtocolFailureResult,
  machineUnavailableResult,
  machineUnusableResult,
  type MachineFailureResult,
} from './machine-call';
import { admitMachineFile, machineScopeLocator } from './grep-machine-wire';
import { type GrepToolError } from './grep-results';

/** The Machine failure vocabulary, as `read` maps it, plus the missing method. */
export function machineGrepFailure(
  name: string,
  error: unknown,
): MachineFailureResult {
  // Before the unavailable branch: a mismatch extends it and is its own result.
  if (error instanceof MachineIdentityMismatchError)
    return machineIdentityMismatchResult(name);

  if (error instanceof MachineUnavailableError)
    return machineUnavailableResult(name, error.reason);

  if (error instanceof MachineUpdateRequiredError)
    return machineUnusableResult(name);

  if (error instanceof MachineProtocolError) {
    // `internal` is the daemon's refusal for an unknown method on older builds.
    return error.code === 'internal'
      ? machineUnusableResult(name)
      : machineProtocolFailureResult(name, error);
  }

  throw error;
}

/** Every passage's Machine locator, or undefined when one cannot be spelled. */
function locatorsOf(
  search: MachineGrepSearch,
  result: FsGrepSuccess,
): ReadonlyArray<string> | undefined {
  const locators: Array<string> = [];

  for (const passage of result.results) {
    const locator = machineScopeLocator(search.scope, passage.path);

    if (locator === undefined) return undefined;
    locators.push(locator);
  }

  return locators;
}

/** One file's admission input: the call's admission, its scope, and its path. */
type MachineFileAdmission = {
  readonly admission: GrepReadAdmission;
  readonly scope: MachineGrepScope;
  readonly decided: Map<string, boolean>;
  readonly rel: string;
  readonly locator: string;
};

/** The `read` verdict for one file, judged once and shared by its passages. */
function admitsFile(input: MachineFileAdmission): boolean {
  const known = input.decided.get(input.rel);

  if (known !== undefined) return known;

  const allowed = admitMachineFile(
    input.admission,
    input.scope,
    input.rel,
    input.locator,
  );

  input.decided.set(input.rel, allowed);

  return allowed;
}

/** One kept passage, in the spelling the call's result carries. */
function keptPassage(passage: FsGrepPassage, locator: string): GrepPassage {
  return {
    locator: formatPassageLocator(locator, passage.startLine, passage.endLine),
    content: passage.content,
    matches: [...passage.matches],
    ...(passage.cut === true && { cut: true as const }),
    ...(passage.truncated === true && { truncated: true as const }),
  };
}

/**
 * The passages the page keeps: each file judged once against the `read` group
 * on its Machine locator, a refused file dropped whole. A refused passage
 * never reaches the result; the daemon position still moves past it.
 */
export function renderPage(
  search: MachineGrepSearch,
  result: FsGrepSuccess,
  into: Array<GrepPassage>,
): GrepToolError | undefined {
  const locators = locatorsOf(search, result);

  if (locators === undefined) return machineUnusableResult(search.scope.name);
  const decided = new Map<string, boolean>();

  for (const [index, passage] of result.results.entries()) {
    const locator = locators[index];

    if (
      !admitsFile({
        admission: search.admission,
        scope: search.scope,
        decided,
        rel: passage.path,
        locator,
      })
    )
      continue;
    into.push(keptPassage(passage, locator));
  }
}
