import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { type UnknownRecord } from '@workspace/runtime-safety';

import {
  readWorkspaceMcpConfig,
  type WorkspaceMcpServerConfig,
} from './workspace-mcp-config';

async function workspace(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'llame-workspace-mcp-'));
}

async function writeJson(file: string, value: UnknownRecord): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(value), 'utf8');
}

function configured(
  entries: ReadonlyArray<WorkspaceMcpServerConfig>,
  id: string,
): Extract<WorkspaceMcpServerConfig, { state: 'configured' }> {
  const entry = entries.find((candidate) => candidate.id === id);
  if (entry?.state !== 'configured') {
    throw new Error(`expected configured server ${id}`);
  }
  return entry;
}

function unavailable(
  entries: ReadonlyArray<WorkspaceMcpServerConfig>,
  id: string,
): Extract<WorkspaceMcpServerConfig, { state: 'unavailable' }> {
  const entry = entries.find((candidate) => candidate.id === id);
  if (entry?.state !== 'unavailable') {
    throw new Error(`expected unavailable server ${id}`);
  }
  return entry;
}

describe('readWorkspaceMcpConfig', () => {
  it('merges .llame over .mcp.json and resolves portable entries', async () => {
    const root = await workspace();
    await writeJson(path.join(root, '.mcp.json'), {
      mcpServers: {
        shared: { command: 'base-command' },
        base: { command: 'base-only', cwd: 'children' },
      },
    });
    await writeJson(path.join(root, '.llame', 'mcp.json'), {
      mcpServers: {
        shared: { command: 'workspace-command', args: ['--literal'] },
        remote: { type: 'http', url: 'https://example.test/mcp' },
      },
    });

    const entries = await readWorkspaceMcpConfig(root, {});
    const shared = configured(entries, 'shared');
    const base = configured(entries, 'base');
    const remote = configured(entries, 'remote');

    expect(shared.definition).toEqual({
      transport: 'stdio',
      command: 'workspace-command',
      args: ['--literal'],
      cwd: root,
    });
    expect(base.definition).toEqual({
      transport: 'stdio',
      command: 'base-only',
      cwd: path.join(root, 'children'),
    });
    expect(remote.definition).toEqual({
      url: 'https://example.test/mcp',
    });
    expect(shared.protectedValues).toEqual([]);
    expect(base.protectedValues).toEqual([]);
    expect(remote.protectedValues).toEqual([]);
  });

  it('resolves every interpolation form once and protects only the required values', async () => {
    const root = await workspace();
    const token = 'path-secret-value';
    await writeFile(path.join(root, 'token.txt'), ` ${token} \n`, 'utf8');
    await writeJson(path.join(root, '.mcp.json'), {
      mcpServers: {
        local: {
          command: '${DIRECT}',
          cwd: '${CWD}',
          args: [
            '${MISSING:-literal-default}',
            '{env:DIRECT}',
            '{path:token.txt}',
            '${OUTER}',
          ],
          env: {
            LITERAL: 'literal-value',
            FALLBACK: '${MISSING:-literal-default}',
            RESOLVED: '${DIRECT}',
          },
        },
        remote: {
          type: 'streamable-http',
          url: 'https://example.test/mcp?key=${DIRECT}',
          headers: {
            Authorization: 'Bearer ${DIRECT}',
            'X-Literal': 'literal-header',
            'X-Fallback': '${MISSING:-remote-default}',
          },
        },
      },
    });

    const entries = await readWorkspaceMcpConfig(root, {
      DIRECT: 'env-secret-value',
      CWD: 'cwd-secret',
      INNER: 'inner-value',
      OUTER: '${INNER}',
      LLAME_AMBIENT_ONLY: 'ambient-secret',
    });
    const local = configured(entries, 'local');
    const remote = configured(entries, 'remote');
    if (local.definition.transport !== 'stdio') {
      throw new Error('expected a stdio definition');
    }

    expect(local.definition.command).toBe('env-secret-value');
    expect(local.definition.cwd).toBe(path.join(root, 'cwd-secret'));
    expect(local.definition.args).toEqual([
      'literal-default',
      'env-secret-value',
      token,
      '${INNER}',
    ]);
    expect(local.definition.env).toEqual({
      LITERAL: 'literal-value',
      FALLBACK: 'literal-default',
      RESOLVED: 'env-secret-value',
    });
    expect(local.definition.env).not.toHaveProperty('LLAME_AMBIENT_ONLY');
    expect(local.protectedValues).toEqual([
      'env-secret-value',
      token,
      '${INNER}',
      'cwd-secret',
    ]);
    expect(remote.protectedValues).toEqual([
      'env-secret-value',
      'Bearer env-secret-value',
      'literal-header',
      'remote-default',
    ]);
  });

  it('marks unresolved variables and files unavailable without exposing values', async () => {
    const root = await workspace();
    await writeJson(path.join(root, '.mcp.json'), {
      mcpServers: {
        missingVariable: { command: '${MISSING_VARIABLE}' },
        missingFile: { command: 'server', args: ['{path:missing/token}'] },
      },
    });

    const entries = await readWorkspaceMcpConfig(root, {});
    const variable = unavailable(entries, 'missingVariable');
    const file = unavailable(entries, 'missingFile');

    expect(variable.reason).toContain('MISSING_VARIABLE');
    expect(variable.reason).not.toContain('resolved-secret');
    expect(file.reason).toContain('missing/token');
    expect(file.reason).not.toContain('resolved-secret');
  });

  it('does not treat inherited environment properties as variables', async () => {
    const root = await workspace();
    await writeJson(path.join(root, '.mcp.json'), {
      mcpServers: { local: { command: '${INHERITED}' } },
    });
    const environment: NodeJS.ProcessEnv = {};
    Object.setPrototypeOf(environment, { INHERITED: 'inherited-secret' });

    const entries = await readWorkspaceMcpConfig(root, environment);
    const local = unavailable(entries, 'local');
    expect(local.reason).toContain('INHERITED');
    expect(local.reason).not.toContain('inherited-secret');
  });
  it('reports malformed entries, names, and transports without rejecting the file', async () => {
    const root = await workspace();
    await writeJson(path.join(root, '.mcp.json'), {
      mcpServers: {
        valid: { command: 'server' },
        'bad.name': { command: 'server' },
        unsupported: { type: 'sse', url: 'https://example.test/mcp' },
        malformed: { type: 'stdio', command: '' },
      },
    });

    const entries = await readWorkspaceMcpConfig(root, {});
    expect(configured(entries, 'valid').state).toBe('configured');
    expect(unavailable(entries, 'bad.name').reason).toContain(
      'invalid server name',
    );
    expect(unavailable(entries, 'unsupported').reason).toContain(
      'unsupported transport sse',
    );
    expect(unavailable(entries, 'malformed').reason).toContain(
      'command must be a non-empty string',
    );
  });

  it('reports malformed files while retaining valid entries from the other source', async () => {
    const root = await workspace();
    await writeFile(path.join(root, '.mcp.json'), '{', 'utf8');
    await writeJson(path.join(root, '.llame', 'mcp.json'), {
      mcpServers: { local: { command: 'server' } },
    });

    const entries = await readWorkspaceMcpConfig(root, {});
    expect(configured(entries, 'local').state).toBe('configured');
    expect(unavailable(entries, '.mcp.json').reason).toContain('malformed');
  });

  it('resolves relative cwd and path tokens from the workspace root', async () => {
    const root = await workspace();
    const outside = path.join(
      path.dirname(root),
      'workspace-mcp-outside-secret.txt',
    );
    await writeFile(outside, 'outside-secret', 'utf8');
    await writeJson(path.join(root, '.mcp.json'), {
      mcpServers: {
        local: {
          command: 'server',
          cwd: 'nested/dir',
          args: ['{path:../workspace-mcp-outside-secret.txt}'],
        },
      },
    });

    const entries = await readWorkspaceMcpConfig(root, {});
    const local = configured(entries, 'local');
    if (local.definition.transport !== 'stdio') {
      throw new Error('expected a stdio definition');
    }
    expect(local.definition.cwd).toBe(path.join(root, 'nested', 'dir'));
    expect(local.definition.args).toEqual(['outside-secret']);
    expect(local.protectedValues).toEqual(['outside-secret']);
    await readFile(outside, 'utf8');
  });

  it('leaves literal stdio env values unprotected and keeps default cwd at root', async () => {
    const root = await workspace();
    await writeJson(path.join(root, '.mcp.json'), {
      mcpServers: {
        local: {
          command: 'server',
          env: { PLAIN: 'literal-value', FALLBACK: '${MISSING:-fallback}' },
        },
      },
    });

    const entries = await readWorkspaceMcpConfig(root, {});
    const local = configured(entries, 'local');
    if (local.definition.transport !== 'stdio') {
      throw new Error('expected a stdio definition');
    }
    expect(local.definition.cwd).toBe(root);
    expect(local.definition.env).toEqual({
      PLAIN: 'literal-value',
      FALLBACK: 'fallback',
    });
    expect(local.protectedValues).toEqual([]);
  });

  it('protects a literal remote Authorization header', async () => {
    const root = await workspace();
    await writeJson(path.join(root, '.mcp.json'), {
      mcpServers: {
        remote: {
          type: 'http',
          url: 'https://example.test/mcp',
          headers: { Authorization: 'literal-authorization' },
        },
      },
    });

    const entries = await readWorkspaceMcpConfig(root, {});
    const remote = configured(entries, 'remote');
    expect(remote.protectedValues).toEqual(['literal-authorization']);
  });
});
