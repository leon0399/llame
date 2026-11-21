import { statfsSync } from "node:fs";
import {
  arch,
  availableParallelism,
  platform,
  release,
  totalmem,
} from "node:os";
import type {
  MachineFacts,
  MachineRootDisk,
} from "@workspace/machine-protocol";

function rootDisk(root: string): MachineRootDisk {
  try {
    const { blocks, bsize } = statfsSync(root);
    const totalBytes = blocks * bsize;

    // A filesystem whose size the wire cannot carry exactly is a null total,
    // never a rounded number.
    return {
      root,
      totalBytes: Number.isSafeInteger(totalBytes) ? totalBytes : null,
    };
  } catch {
    return { root, totalBytes: null };
  }
}

/**
 * What this Machine is, as the handshake reports it: enough for the hub to
 * tell boxes apart and to show their capacity without another round trip.
 */
export function machineFacts(roots: ReadonlyArray<string>): MachineFacts {
  return {
    os: platform(),
    arch: arch(),
    kernel: release(),
    cpuCount: availableParallelism(),
    totalMemoryBytes: totalmem(),
    rootDisks: roots.map(rootDisk),
  };
}
