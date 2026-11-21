import { type Db } from '../db/tenant-db.service';
import { ProjectLinksRepository } from '../projects/project-links.repository';
import { type StartLocationSource } from '../projects/start-location';
import { parseMachineLocator } from '../machines/machine-locator';
import { type MachineStatusView } from '../machines/machines-status';
import { type ExecutorTarget } from '../machines/executor-git.service';

/*
 * Executor identity for chat creation (openspec `chat-start-location`, design
 * D9): whether a resolved executor can run right now, the typed target one
 * resolved location runs on, and the read source the resolver's implicit step
 * filters. Whether the configuration declares an id at all is the connector's
 * own `isConfigured`.
 *
 * Every executor id is a Machine name, the host Machine included: there is no
 * `machine:` prefix and no separate local id. The host Machine is a normal
 * entry, so it can be offline like any other, and its target is addressed by
 * its canonical `machine://` locator.
 */

/**
 * Whether the resolved executor can run right now, from the Machines read
 * model. Every Machine — the host Machine included — is online only while its
 * last successful contact is inside the window and no later contact failed.
 */
export function executorOnline(
  executorId: string,
  input: { readonly machines: ReadonlyArray<MachineStatusView> },
): boolean {
  return input.machines.some(
    (machine) => machine.name === executorId && machine.status === 'online',
  );
}

/**
 * The typed target of one resolved location. The stored address must be a
 * locator of the row's own Machine, so an inconsistent row binds nothing.
 */
export function executorTarget(
  executorId: string,
  address: string,
): ExecutorTarget | undefined {
  const parsed = parseMachineLocator(address);

  if (parsed.kind !== 'path' || parsed.name !== executorId) return undefined;

  return { executorId, machine: executorId, path: parsed.path };
}

/**
 * The start-location resolver's read source, narrowed to what a start may use:
 * the unfiltered `main` checkout step drops every offline executor, so an
 * implicit step never selects a Machine the hub cannot reach. The
 * executor-filtered call is left alone: an explicit, named, or remembered
 * executor is answered as unavailable instead of being skipped.
 */
export function creationLocationSource(
  tx: Db,
  online: (executorId: string) => boolean,
): StartLocationSource {
  const links = new ProjectLinksRepository(tx);

  return {
    listLinks: (owner, projectId) => links.listLinks(owner, projectId),
    findRepository: (owner, repositoryId) =>
      links.findRepository(owner, repositoryId),
    findCheckout: (owner, checkoutId) => links.findCheckout(owner, checkoutId),
    findDefault: (owner, linkId, executorId) =>
      links.findDefault(owner, linkId, executorId),
    findLatestDefault: (owner, linkId) =>
      links.findLatestDefault(owner, linkId),
    listMainCheckouts: async (owner, repositoryId, executorId) => {
      const rows = await links.listMainCheckouts(
        owner,
        repositoryId,
        executorId,
      );

      return executorId === undefined
        ? rows.filter((row) => online(row.executorId))
        : rows;
    },
    countOpenChatsBoundTo: (owner, root, executorId) =>
      links.countOpenChatsBoundTo(owner, root, executorId),
  };
}
