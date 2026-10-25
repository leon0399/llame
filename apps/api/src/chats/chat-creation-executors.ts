import { type Db } from '../db/tenant-db.service';
import { type LlameConfig } from '../instance-config/llame-config';
import { ProjectLinksRepository } from '../projects/project-links.repository';
import { type StartLocationSource } from '../projects/start-location';
import {
  parseMachineExecutorId,
  parseMachineLocator,
} from '../machines/machine-locator';
import { type MachineStatusView } from '../machines/machines-status';
import { type ExecutorTarget } from '../machines/executor-git.service';

/*
 * Executor identity for chat creation (openspec `chat-start-location`, design
 * D9): whether the configuration provides an executor id at all, whether that
 * executor can run right now, and the typed target one resolved location runs
 * on. A local executor is this process's `tools.nativeExecutorId`; every other
 * id is `machine:<name>`, which is configured only while `machines.hosts` names
 * it and online only while its recorded contact derives `online`.
 */

type ExecutorConfig = Pick<LlameConfig, 'tools' | 'machines'>;

/** Whether the configuration provides this executor id at all. */
export function isConfiguredExecutor(
  executorId: string,
  config: ExecutorConfig,
): boolean {
  if (executorId === config.tools.nativeExecutorId) return true;
  const name = parseMachineExecutorId(executorId);
  return (
    name !== undefined &&
    config.machines !== undefined &&
    Object.hasOwn(config.machines.hosts, name)
  );
}

/**
 * Whether the resolved executor can run right now, from the Machines read
 * model. The local executor is never offline; a Machine is online only while
 * its last successful contact is inside the window and no later contact failed.
 */
export function executorOnline(
  executorId: string,
  input: {
    readonly config: ExecutorConfig;
    readonly machines: ReadonlyArray<MachineStatusView>;
  },
): boolean {
  if (executorId === input.config.tools.nativeExecutorId) return true;
  const name = parseMachineExecutorId(executorId);
  return (
    name !== undefined &&
    input.machines.some(
      (machine) => machine.name === name && machine.status === 'online',
    )
  );
}

/**
 * The typed target of one resolved location. A local executor keeps the stored
 * address as its path; a Machine executor requires the stored address to be a
 * locator of that same Machine, so an inconsistent row binds nothing.
 */
export function executorTarget(
  executorId: string,
  address: string,
): ExecutorTarget | undefined {
  const name = parseMachineExecutorId(executorId);
  if (name === undefined) {
    return { executorId, machine: undefined, path: address };
  }
  const parsed = parseMachineLocator(address);
  if (parsed.kind !== 'path' || parsed.name !== name) return undefined;
  return { executorId, machine: name, path: parsed.path };
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
