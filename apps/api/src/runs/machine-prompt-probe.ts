/**
 * Prompt-import resolution on a Machine (remote-machines "Machine instruction
 * files are discovered within the containing root"): a `@path` marker that
 * names a Machine target resolves to its canonical locator when the target
 * exists, and stays prose otherwise.
 */

import { type MachineConnector } from '../machines/machine-connector.service';
import { formatMachineLocator } from '../machines/machine-locator';
import { readFsStatResult } from '../machines/machine-results';
import { machineEnvelope } from './machine-attempt';

/** The connector surface a probe needs. */
export type MachinePromptConnector = Pick<
  MachineConnector,
  'enabled' | 'isConfigured' | 'request'
>;

export type MachinePromptIdentity = {
  readonly runId: string;
  readonly deliverySequence: number | undefined;
  readonly signal: AbortSignal | undefined;
};

/**
 * The canonical Machine locator of an existing target, or undefined when it is
 * absent or the Machine cannot answer. Both look the same here, exactly as an
 * unreadable host path does, so the marker stays prose and the probe discloses
 * nothing.
 */
export async function probeMachinePromptTarget(
  connector: MachinePromptConnector | undefined,
  identity: MachinePromptIdentity,
  target: { readonly name: string; readonly path: string },
): Promise<string | undefined> {
  if (
    connector === undefined ||
    !connector.enabled() ||
    !connector.isConfigured(target.name)
  ) {
    return undefined;
  }
  // Every way a Machine can fail to answer — a refused request, an unreachable
  // session, an answer the protocol does not promise — reads the same here,
  // exactly as an unreadable host path does. `resolve().then` turns a connector
  // that throws where it should reject into the rejection the chain catches.
  const answer = await Promise.resolve()
    .then(() =>
      connector.request(
        target.name,
        'fs.stat',
        {
          envelope: machineEnvelope({
            runId: identity.runId,
            deliverySequence: identity.deliverySequence,
          }),
          path: target.path,
        },
        { signal: identity.signal },
      ),
    )
    .then(readFsStatResult)
    .catch(() => undefined);
  if (answer === undefined || answer.kind === 'missing') return undefined;
  return formatMachineLocator(target.name, answer.realPath ?? target.path);
}
