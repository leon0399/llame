import type { HelloResult } from '@workspace/machine-protocol';

export type HandshakeInfo = {
  readonly protocolVersion: number;
  readonly release: string;
  readonly instanceId: string;
  readonly buildId: string;
  readonly facts?: {
    readonly os?: string;
    readonly arch?: string;
    readonly kernel?: string;
    readonly cpuCount?: number;
    readonly memoryBytes?: bigint;
  };
};

export type HandshakeRootInfo = {
  readonly roots: ReadonlyArray<{
    readonly path: string;
    readonly filesystemBytes?: bigint;
  }>;
};

export function createHelloResult(
  info: HandshakeInfo,
  rootInfo: HandshakeRootInfo,
): HelloResult {
  const facts = info.facts;

  return {
    protocolVersion: Number(info.protocolVersion),
    daemonVersion: info.release,
    roots: rootInfo.roots.map((root) => root.path),
    instanceId: info.instanceId,
    buildId: info.buildId,
    facts: {
      os: facts?.os ?? '',
      arch: facts?.arch ?? '',
      kernel: facts?.kernel ?? '',
      cpuCount: facts?.cpuCount ?? 0,
      totalMemoryBytes: Number(facts?.memoryBytes ?? 0n),
      rootDisks: rootInfo.roots.map((root) => ({
        root: root.path,
        totalBytes:
          root.filesystemBytes === undefined
            ? null
            : Number(root.filesystemBytes),
      })),
    },
  };
}
