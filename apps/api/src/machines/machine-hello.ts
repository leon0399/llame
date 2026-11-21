/**
 * Untrusted-input narrowing for the Machine handshake. A Machine is not a
 * trusted peer, so the `hello` answer and the static facts it carries are
 * REBUILT from validated fields: a daemon that answers a wrong shape narrows to
 * undefined and the session fails as `incompatible_version`, rather than
 * letting a malformed value reach a row or a response.
 */

import {
  BUILD_ID_PATTERN,
  GIT_METHODS,
  INSTANCE_ID_PATTERN,
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
} from './machines-status';

/** An `os.platform()` or `os.arch()` token: lowercase words and digits. */
const PLATFORM_TOKEN_PATTERN = /^[a-z0-9_]{1,32}$/u;

/** A kernel release as `os.release()` reports it: printable ASCII only. */
const KERNEL_RELEASE_PATTERN = /^[\x21-\x7e]{1,128}$/u;

/** Whether the text carries a C0 control character or DEL. */
function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;

    if (code < 0x20 || code === 0x7f) return true;
  }

  return false;
}

/** A registered root: absolute, bounded, and free of control characters. */
function isMachineRoot(value: SerializableValue): value is string {
  return (
    isText(value) &&
    value.length > 0 &&
    value.length <= MACHINE_ROOT_MAX_LENGTH &&
    value.startsWith('/') &&
    !hasControlCharacter(value)
  );
}

/** A count of bytes: a whole number a JavaScript number can hold exactly. */
function isByteCount(value: SerializableValue): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/** One registered root and the size of the filesystem holding it. */
function readRootDisk(value: SerializableValue): MachineRootDisk | undefined {
  if (!isSerializableRecord(value)) return undefined;
  const { root, totalBytes } = value;

  if (!isMachineRoot(root)) return undefined;

  // `statfs` failing is a legitimate null; anything else must be a byte count.
  if (totalBytes !== null && !isByteCount(totalBytes)) return undefined;

  return { root, totalBytes };
}

function readRootDisks(
  value: SerializableValue,
): ReadonlyArray<MachineRootDisk> | undefined {
  if (!isUntrustedList(value)) return undefined;
  const disks: Array<MachineRootDisk> = [];

  // Bounded like `boundMachineRoots`: the first entries are the report, and a
  // daemon cannot make the hub read an unbounded list.
  for (const entry of value) {
    if (disks.length >= MACHINE_ROOTS_LIMIT) break;
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

  // Every daemon string that reaches a row or a response is a token from a
  // known grammar: a newline in `os` or a NUL in `kernel` is not a Machine's
  // platform, and a daemon that reports one is unusable.
  if (
    !isText(os) ||
    !PLATFORM_TOKEN_PATTERN.test(os) ||
    !isText(arch) ||
    !PLATFORM_TOKEN_PATTERN.test(arch) ||
    !isText(kernel) ||
    !KERNEL_RELEASE_PATTERN.test(kernel) ||
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

  const {
    protocolVersion,
    daemonVersion,
    roots,
    methods,
    instanceId,
    buildId,
    facts: reportedFacts,
  } = value;

  if (!isCount(protocolVersion) || !isText(daemonVersion) || !isTextList(roots))
    return undefined;
  const facts = readMachineFacts(reportedFacts);

  if (
    !isText(instanceId) ||
    !INSTANCE_ID_PATTERN.test(instanceId) ||
    !isText(buildId) ||
    !BUILD_ID_PATTERN.test(buildId) ||
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

  // `methods` is optional on the wire and absent from a daemon that answers
  // none. A malformed one is read as absent too, because the handshake is
  // still usable: its file tools and `bash` keep working while a git call asks
  // for an update.
  const listed = isTextList(methods)
    ? GIT_METHODS.filter((method) => methods.includes(method))
    : [];

  return listed.length === 0 ? hello : { ...hello, methods: listed };
}
