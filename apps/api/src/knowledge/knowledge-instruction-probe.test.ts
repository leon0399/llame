/**
 * The owner-scoped Knowledge probe the instructions producer walks
 * (openspec/changes/instruction-files/knowledge): a Space that is not the
 * owner's is one indistinguishable `undefined`, and a path that leaves the
 * Space between validation and the probe is reported as missing. Real
 * temporary directories hold the Spaces; only the owner binding lookup is a
 * fake, because that is the only authority the probe has.
 */

import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { type KnowledgeToolResolver } from '../tools/types';
import {
  KnowledgeFilesystemAdapter,
  type KnowledgeFilesystemAdapterPort,
  type KnowledgeFilesystemBinding,
} from './knowledge-filesystem';
import { createKnowledgeInstructionProbe } from './knowledge-instruction-probe';

const SPACE = 'a6230f3c-4a5e-4c9b-8f0e-1d2c3b4a5e6f';
const OTHER_SPACE = 'b6230f3c-4a5e-4c9b-8f0e-1d2c3b4a5e6f';

/** The Knowledge root: it holds every owner's Spaces and nothing else. */
let root: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'llame-knowledge-probe-'));
  mkdirSync(path.join(root, SPACE), { recursive: true });
  mkdirSync(path.join(root, OTHER_SPACE), { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function bindingOf(knowledgeSpaceId: string): KnowledgeFilesystemBinding {
  return {
    id: knowledgeSpaceId,
    root,
    directory: path.join(root, knowledgeSpaceId),
  };
}

/** A resolver that owns exactly `SPACE` and hands out `adapter` for it. */
function resolverOver(
  adapter: KnowledgeFilesystemAdapterPort,
): KnowledgeToolResolver {
  return {
    listForOwnerPage: () => Promise.reject(new Error('not used')),
    resolveBindingForOwnerById: (_ownerUserId, knowledgeSpaceId) =>
      Promise.resolve(
        knowledgeSpaceId === SPACE ? bindingOf(SPACE) : undefined,
      ),
    createAdapter: () => adapter,
  };
}

/** The probe this owner would resolve `SPACE` through. */
function probeOver(
  adapter: KnowledgeFilesystemAdapterPort,
  signal?: AbortSignal,
) {
  return createKnowledgeInstructionProbe({
    resolver: resolverOver(adapter),
    ownerUserId: 'owner',
    signal,
  });
}

describe('createKnowledgeInstructionProbe', () => {
  it('answers a foreign or absent Space with nothing at all', async () => {
    const probe = probeOver(new KnowledgeFilesystemAdapter(bindingOf(SPACE)));

    expect(await probe(SPACE)).toBeDefined();
    expect(await probe(OTHER_SPACE)).toBeUndefined();
    expect(await probe('not-a-space')).toBeUndefined();
  });

  it('resolves no scope for a Space whose directory is gone', async () => {
    const adapter = new KnowledgeFilesystemAdapter(bindingOf(SPACE));
    rmSync(path.join(root, SPACE), { recursive: true, force: true });

    // A Space that cannot be opened has no scope, so not one of its candidates
    // is ever probed.
    expect(await probeOver(adapter)(SPACE)).toBeUndefined();
  });

  it('reports a component swapped to a link out of the Space as missing', async () => {
    const honest = new KnowledgeFilesystemAdapter(bindingOf(SPACE));
    // Another owner's Space holds a real `notes/AGENTS.md`; this Space's
    // `notes` is a link to it.
    mkdirSync(path.join(root, OTHER_SPACE, 'notes'), { recursive: true });
    writeFileSync(
      path.join(root, OTHER_SPACE, 'notes/AGENTS.md'),
      'foreign rules\n',
    );
    symlinkSync(
      path.join(root, OTHER_SPACE, 'notes'),
      path.join(root, SPACE, 'notes'),
    );

    // Control: the trusted resolver refuses the link outright.
    const refused = await probeOver(honest)(SPACE);
    expect(await refused?.probe('notes')).toEqual({ kind: 'missing' });

    // The raced adapter is the same port, except resolution returned the path
    // it validated a moment before the link appeared — the check-to-open window
    // the resolver documents. Containment is what still refuses it.
    const raced = await probeOver(racedAdapter(honest))(SPACE);
    expect(await raced?.probe('notes')).toEqual({ kind: 'missing' });
    expect(await raced?.list('notes')).toEqual([]);
    // A directory that really is inside the Space keeps answering.
    writeFileSync(path.join(root, SPACE, 'CLAUDE.md'), 'space rules\n');
    expect(await raced?.probe('CLAUDE.md')).toEqual({
      kind: 'file',
      size: 12,
    });
  });

  it('stops on a cancelled Run instead of reporting the entry missing', async () => {
    const controller = new AbortController();
    const scope = await probeOver(
      new KnowledgeFilesystemAdapter(bindingOf(SPACE)),
      controller.signal,
    )(SPACE);
    controller.abort();

    await expect(scope?.probe('CLAUDE.md')).rejects.toMatchObject({
      code: 'knowledge_cancelled',
    });
  });

  it('resolves no scope for a Space whose own directory is not inside it', async () => {
    const real = new KnowledgeFilesystemAdapter(bindingOf(SPACE));
    const outside = (hostPath: string) =>
      Promise.resolve(hostPath !== path.join(root, SPACE));

    // The Space root resolves, and containment says it is not the Space: no
    // scope at all, so not one of its candidates is ever probed.
    const scope = await probeOver({
      search: (query, limit, options) => real.search(query, limit, options),
      isInsideSpace: outside,
      resolveHostPath: (relativePath, options) =>
        real.resolveHostPath(relativePath, options),
    })(SPACE);
    expect(scope).toBeUndefined();
  });

  it('asks the trusted resolver with the Space root, a may-be-missing path, and the Run signal', async () => {
    const real = new KnowledgeFilesystemAdapter(bindingOf(SPACE));
    const calls: Array<{
      readonly relativePath: string | undefined;
      readonly options: unknown;
    }> = [];
    const containment: Array<AbortSignal | undefined> = [];
    const controller = new AbortController();
    writeFileSync(path.join(root, SPACE, 'CLAUDE.md'), 'space rules\n');
    const scope = await probeOver(
      {
        search: (query, limit, options) => real.search(query, limit, options),
        isInsideSpace: (hostPath, signal) => {
          containment.push(signal);
          return real.isInsideSpace(hostPath, signal);
        },
        resolveHostPath: (relativePath, options) => {
          calls.push({ relativePath, options });
          return real.resolveHostPath(relativePath, options);
        },
      },
      controller.signal,
    )(SPACE);

    expect(await scope?.probe('CLAUDE.md')).toEqual({
      kind: 'file',
      size: 12,
    });
    await scope?.list('');

    // The Space's own directory is asked for as the root itself — once up
    // front, once for the listing — and an entry is asked for by its
    // Space-relative path, each as a path that may be absent rather than as an
    // error the walk has to catch.
    expect(calls.map((call) => call.relativePath)).toEqual([
      undefined,
      'CLAUDE.md',
      undefined,
    ]);
    // The up-front root check carries the Run's own signal; every entry in the
    // walk additionally asks for a path that may be absent rather than as an
    // error the walk has to catch.
    expect(calls[0]?.options).toEqual({ signal: controller.signal });
    for (const call of calls.slice(1)) {
      expect(call.options).toEqual({
        allowMissing: true,
        signal: controller.signal,
      });
    }
    // A cancelled Run reaches every call, so the walk stops where the
    // producer's own abort check would.
    expect(containment.every((signal) => signal === controller.signal)).toBe(
      true,
    );
  });

  it('reports a missing entry and an empty listing rather than failing', async () => {
    const scope = await probeOver(
      new KnowledgeFilesystemAdapter(bindingOf(SPACE)),
    )(SPACE);

    // Nothing here exists, and the chain simply continues past it.
    expect(await scope?.probe('absent.md')).toEqual({ kind: 'missing' });
    expect(await scope?.list('absent')).toEqual([]);
  });

  it('reports an entry that is neither a file nor a directory as missing', async () => {
    const scope = await probeOver(
      new KnowledgeFilesystemAdapter(bindingOf(SPACE)),
    )(SPACE);
    // A socket is a real entry the reader could never open as a file: it is
    // skipped exactly like a device node, never selected as a candidate.
    const server = createServer();
    await new Promise<void>((resolve) =>
      server.listen(path.join(root, SPACE, 'socket'), resolve),
    );
    try {
      expect(await scope?.probe('socket')).toEqual({ kind: 'missing' });
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('reports an entry missing when the containment check itself fails', async () => {
    const honest = new KnowledgeFilesystemAdapter(bindingOf(SPACE));
    writeFileSync(path.join(root, SPACE, 'CLAUDE.md'), 'space rules\n');
    mkdirSync(path.join(root, SPACE, 'notes'), { recursive: true });
    writeFileSync(path.join(root, SPACE, 'notes/AGENTS.md'), 'note rules\n');
    const scope = await probeOver({
      search: (query, limit, options) => honest.search(query, limit, options),
      isInsideSpace: (hostPath) =>
        hostPath === path.join(root, SPACE)
          ? Promise.resolve(true)
          : Promise.reject(new Error('containment unavailable')),
      resolveHostPath: (relativePath, options) =>
        honest.resolveHostPath(relativePath, options),
    })(SPACE);

    // Containment that cannot be answered is containment that cannot be
    // claimed: the entry is missing and the directory lists nothing, exactly
    // as it would for a link that resolved outside the Space.
    expect(await scope?.probe('CLAUDE.md')).toEqual({ kind: 'missing' });
    expect(await scope?.list('notes')).toEqual([]);
  });
});

/** The same adapter with the link check taken out of `resolveHostPath`. */
function racedAdapter(
  real: KnowledgeFilesystemAdapter,
): KnowledgeFilesystemAdapterPort {
  return {
    search: (query, limit, options) => real.search(query, limit, options),
    isInsideSpace: (hostPath, signal) => real.isInsideSpace(hostPath, signal),
    resolveHostPath: (relativePath) =>
      Promise.resolve(path.join(root, SPACE, relativePath ?? '')),
  };
}
