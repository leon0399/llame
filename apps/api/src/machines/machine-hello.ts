/**
 * Untrusted-input narrowing for the Machine handshake. A Machine is not a
 * trusted peer, so the `hello` answer and the static facts it carries are
 * REBUILT from validated fields: a daemon that answers a wrong shape narrows to
 * undefined and the session fails as `incompatible_version`, rather than
 * letting a malformed value reach a row or a response.
 */

import {
  GIT_METHODS,
  isSerializableRecord,
  type HelloResult,
  type JsonValue,
  type MachineFacts,
  type MachineRootDisk,
  type SerializableValue,
} from '@workspace/machine-protocol';

import {
  isCount,
  isText,
  isTextList,
  isUntrustedList,
} from './machine-results';
import {
  MACHINE_ROOT_MAX_LENGTH,
  MACHINE_ROOTS_LIMIT,
  MACHINE_VERSION_MAX_LENGTH,
} from './machines-status';

/** A daemon's persistent identity: lowercase UUID v4 text, nothing else. */
const MACHINE_INSTANCE_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

/** The shipped bundle's content hash, or the daemon's honest "unknown". */
const MACHINE_BUILD_ID = /^(?:[0-9a-f]{12}|unknown)$/u;

/** A non-empty daemon string, bounded before it can reach a row or a response. */
function isBoundedMachineText(
  value: SerializableValue,
  maxLength: number,
): value is string {
  return isText(value) && value.length > 0 && value.length <= maxLength;
}

/** A count of bytes: a whole number a JavaScript number can hold exactly. */
function isByteCount(value: SerializableValue): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/** One registered root and the size of the filesystem holding it. */
function readRootDisk(value: SerializableValue): MachineRootDisk | undefined {
  if (!isSerializableRecord(value)) return undefined;
  const { root, totalBytes } = value;

  if (!isBoundedMachineText(root, MACHINE_ROOT_MAX_LENGTH)) return undefined;

  // `statfs` failing is a legitimate null; anything else must be a byte count.
  if (totalBytes !== null && !isByteCount(totalBytes)) return undefined;

  return { root, totalBytes };
}

function readRootDisks(
  value: SerializableValue,
): ReadonlyArray<MachineRootDisk> | undefined {
  if (!isUntrustedList(value) || value.length > MACHINE_ROOTS_LIMIT)
    return undefined;
  const disks: Array<MachineRootDisk> = [];

  for (const entry of value) {
    const disk = readRootDisk(entry);

    if (disk === undefined) return undefined;
    disks.push(disk);
  }

  return disks;
}

/** The static facts a Machine reports at its handshake. */
function readMachineFacts(value: SerializableValue): MachineFacts | undefined {
  if (!isSerializableRecord(value)) return undefined;
  const { os, arch, kernel, cpuCount, totalMemoryBytes, rootDisks } = value;

  if (
    !isBoundedMachineText(os, MACHINE_VERSION_MAX_LENGTH) ||
    !isBoundedMachineText(arch, MACHINE_VERSION_MAX_LENGTH) ||
    !isBoundedMachineText(kernel, MACHINE_VERSION_MAX_LENGTH) ||
    !isByteCount(cpuCount) ||
    !isByteCount(totalMemoryBytes)
  )
    return undefined;
  const disks = readRootDisks(rootDisks);

  if (disks === undefined) return undefined;

  return { os, arch, kernel, cpuCount, totalMemoryBytes, rootDisks: disks };
}

/**
 * The handshake answer: protocol version, versions, registered roots, the
 * daemon's persistent identity and build, the Machine's static facts, and the
 * git methods the daemon answers. A daemon that predates protocol version 2
 * omits the identity and facts, so it narrows to undefined and the handshake
 * fails as `incompatible_version`.
 */
export function readHelloResult(value: JsonValue): HelloResult | undefined {
  if (!isSerializableRecord(value)) return undefined;
  const { protocolVersion, daemonVersion, roots, methods } = value;

  if (!isCount(protocolVersion) || !isText(daemonVersion) || !isTextList(roots))
    return undefined;

  const instanceId = value['instanceId'];
  const buildId = value['buildId'];
  const facts = readMachineFacts(value['facts']);

  if (
    !isText(instanceId) ||
    !MACHINE_INSTANCE_ID.test(instanceId) ||
    !isText(buildId) ||
    !MACHINE_BUILD_ID.test(buildId) ||
    facts === undefined
  )
    return undefined;

  const hello: HelloResult = {
    protocolVersion,
    daemonVersion,
    roots: [...roots],
    instanceId,
    buildId,
    facts,
  };

  // A daemon that predates the git methods sends no list at all. A malformed
  // one is read as absent too, because the handshake is still usable: its file
  // tools and `bash` keep working while a git call asks for an update.
  const listed = isTextList(methods)
    ? GIT_METHODS.filter((method) => methods.includes(method))
    : [];

  return listed.length === 0 ? hello : { ...hello, methods: listed };
}
