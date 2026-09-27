import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
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
    expect(Object.hasOwn(base.definition, 'args')).toBe(false);
    expect(Object.hasOwn(base.definition, 'env')).toBe(false);
    expect(Object.hasOwn(remote.definition, 'headers')).toBe(false);
    expect(
      entries.find((entry) => entry.id === '.llame/mcp.json'),
    ).toBeUndefined();
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
        primitive: null,
        missingTransport: { url: 'https://example.test/mcp' },
        invalidTransport: { type: {}, url: 'https://example.test/mcp' },
        malformed: { type: 'stdio', command: '' },
        badArgs: { command: 'server', args: ['valid', 1] },
        badEnv: { command: 'server', env: 'bad' },
        badEnvValue: { command: 'server', env: { TOKEN: 1 } },
        emptyEnvName: { command: 'server', env: { '': 'value' } },
        badCwd: { command: 'server', cwd: 1 },
        unknownStdio: { command: 'server', shell: true },
        unknownRemote: {
          type: 'http',
          url: 'https://example.test/mcp',
          extra: true,
        },
        httpWithCommand: { type: 'http', command: 'server' },
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
    expect(unavailable(entries, 'missingTransport').reason).toContain(
      'unsupported transport missing',
    );
    expect(unavailable(entries, 'invalidTransport').reason).toContain(
      'unsupported transport invalid',
    );
    expect(unavailable(entries, 'malformed').reason).toContain(
      'command must be a non-empty string',
    );
    expect(unavailable(entries, 'badArgs').reason).toContain(
      'args must be an array of strings',
    );
    expect(unavailable(entries, 'badEnv').reason).toContain(
      'env must be an object',
    );
    expect(unavailable(entries, 'badEnvValue').reason).toContain(
      'env.TOKEN must be a string',
    );
    expect(unavailable(entries, 'emptyEnvName').reason).toContain(
      'env. must be a string',
    );
    expect(unavailable(entries, 'primitive').reason).toContain(
      'invalid server entry',
    );
    expect(unavailable(entries, 'badCwd').reason).toContain(
      'cwd must be a string',
    );
    expect(unavailable(entries, 'unknownStdio').reason).toContain(
      'unknown field shell',
    );
    expect(unavailable(entries, 'unknownRemote').reason).toContain(
      'unknown field extra',
    );
    expect(unavailable(entries, 'httpWithCommand').reason).toContain(
      'unknown field command',
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

  it('reports file read and parsed-shape failures with precise diagnostics', async () => {
    const root = await workspace();
    await mkdir(path.join(root, '.mcp.json'));
    const readFailure = await readWorkspaceMcpConfig(root, {});
    expect(unavailable(readFailure, '.mcp.json').reason).toContain(
      'could not be read',
    );
    await rm(path.join(root, '.mcp.json'), { recursive: true });

    await writeFile(path.join(root, '.mcp.json'), JSON.stringify([]), 'utf8');
    const arrayFile = await readWorkspaceMcpConfig(root, {});
    expect(unavailable(arrayFile, '.mcp.json').reason).toContain(
      'must contain an object',
    );

    await writeJson(path.join(root, '.mcp.json'), { mcpServers: 'bad' });
    const badWrapper = await readWorkspaceMcpConfig(root, {});
    expect(unavailable(badWrapper, '.mcp.json').reason).toContain(
      'has an invalid mcpServers object',
    );
    expect(
      badWrapper.find((entry) => entry.id === '.llame/mcp.json'),
    ).toBeUndefined();
  });

  it('rejects malformed remote URLs and header configurations', async () => {
    const root = await workspace();
    await writeJson(path.join(root, '.mcp.json'), {
      mcpServers: {
        blankUrl: { type: 'http', url: '   ' },
        ftpUrl: { type: 'http', url: 'ftp://example.test/mcp' },
        userInfo: { type: 'http', url: 'https://user:pass@example.test/mcp' },
        badHeaderName: {
          type: 'http',
          url: 'https://example.test/mcp',
          headers: { 'bad header': 'value' },
        },
        collidingHeaders: {
          type: 'http',
          url: 'https://example.test/mcp',
          headers: { Foo: 'one', foo: 'two' },
        },
        ownedHeader: {
          type: 'http',
          url: 'https://example.test/mcp',
          headers: { Accept: 'value' },
        },
        nonStringHeader: {
          type: 'http',
          url: 'https://example.test/mcp',
          headers: { Token: 1 },
        },
        blankHeader: {
          type: 'http',
          url: 'https://example.test/mcp',
          headers: { Token: '   ' },
        },
      },
    });

    const entries = await readWorkspaceMcpConfig(root, {});
    expect(unavailable(entries, 'blankUrl').reason).toContain(
      'url must be a non-empty string',
    );
    expect(unavailable(entries, 'ftpUrl').reason).toContain(
      'absolute http or https URL',
    );
    expect(unavailable(entries, 'userInfo').reason).toContain(
      'without userinfo',
    );
    expect(unavailable(entries, 'badHeaderName').reason).toContain(
      'invalid header bad header',
    );
    expect(unavailable(entries, 'collidingHeaders').reason).toContain(
      'header names collide',
    );
    expect(unavailable(entries, 'ownedHeader').reason).toContain(
      'transport-owned header Accept',
    );
    expect(unavailable(entries, 'nonStringHeader').reason).toContain(
      'header Token must be a string',
    );
    expect(unavailable(entries, 'blankHeader').reason).toContain(
      'header Token must be non-empty',
    );
  });

  it('rejects empty interpolated protected values without adding empty secrets', async () => {
    const root = await workspace();
    await writeJson(path.join(root, '.mcp.json'), {
      mcpServers: {
        local: { command: 'server', args: ['${EMPTY}'] },
      },
    });

    const entries = await readWorkspaceMcpConfig(root, { EMPTY: '' });
    const local = configured(entries, 'local');
    expect(local.protectedValues).toEqual([]);
    if (local.definition.transport !== 'stdio') {
      throw new Error('expected a stdio definition');
    }
    expect(local.definition.args).toEqual(['']);
  });

  it('protects literal Authorization and accepts valid HTTP URLs', async () => {
    const root = await workspace();
    await writeJson(path.join(root, '.mcp.json'), {
      mcpServers: {
        http: { type: 'http', url: 'http://example.test/mcp' },
        remote: {
          type: 'http',
          url: 'https://example.test/mcp',
          headers: { Authorization: 'literal-authorization' },
        },
      },
    });

    const entries = await readWorkspaceMcpConfig(root, {});
    expect(configured(entries, 'http').definition).toEqual({
      url: 'http://example.test/mcp',
    });
    expect(configured(entries, 'remote').definition).toEqual({
      url: 'https://example.test/mcp',
      headers: { Authorization: 'literal-authorization' },
    });
    expect(configured(entries, 'remote').protectedValues).toEqual([
      'literal-authorization',
    ]);
  });
});
