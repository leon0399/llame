import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { McpServerClient } from './mcp-server-client';
import { loadInstanceConfig } from '../instance-config/config-loader';

const FIXTURE = join(__dirname, 'mcp-stdio-test-fixture.mjs');

/**
 * Spans the seam this stack deliberately split: the config layer derives
 * protected values from secret interpolation, and the client layer redacts
 * them. Each half is unit-tested alone; only together do they prove that an
 * operator-configured secret actually stays out of a server's output.
 */
describe('stdio config-to-client seam', () => {
  it('redacts a config-interpolated secret from diagnostics and results', async () => {
    const secret = 'ghp_seam_secret_value';
    const dir = mkdtempSync(join(tmpdir(), 'mcp-seam-'));
    const configPath = join(dir, 'llame.config.json');
    writeFileSync(
      configPath,
      JSON.stringify({
        mcpServers: {
          local: {
            type: 'stdio',
            command: process.execPath,
            args: [FIXTURE, '--root', '/srv/data'],
            env: { SERVER_TOKEN: '{env:SEAM_PAT}' },
          },
        },
      }),
      'utf8',
    );
    // The loader takes its environment explicitly, so the path override
    // belongs in the same object rather than in process.env.
    const entry = loadInstanceConfig({
      SEAM_PAT: secret,
      LLAME_CONFIG_PATH: configPath,
    }).mcpServers.local;
    if (entry.type !== 'stdio') expect.unreachable('expected a stdio entry');

    // The config layer's job: the secret is protected, the literal path is not.
    expect(entry.protectedValues).toEqual([secret]);

    const seen: Array<string> = [];
    const client = await McpServerClient.connectStdio({
      serverId: 'local',
      command: entry.command,
      args: entry.args,
      env: {
        ...entry.env,
        MCP_FIXTURE: JSON.stringify({
          tools: [
            {
              name: 'lookup',
              description: 'd',
              inputSchema: { type: 'object' },
            },
          ],
          stderr: [`connecting with ${secret}\n`],
          callResult: { content: [{ type: 'text', text: `used ${secret}` }] },
        }),
      },
      protectedValues: entry.protectedValues,
      onDiagnostic: (text) => seen.push(text),
    });

    try {
      const discovery = await client.discover();
      const outcome = await discovery.tools[0].execute(
        { path: '/srv/data/notes.md' },
        { toolCallId: 'c1', messages: [] },
      );

      // The client layer's job: neither channel carries the secret.
      expect(seen.join('')).not.toContain(secret);
      expect(seen.join('')).toContain('connecting with');
      expect(JSON.stringify(outcome.result)).not.toContain(secret);

      // And the literal path stays usable — protecting it would have refused
      // this call as invalid_input.
      expect(outcome.result.status).toBe('success');
    } finally {
      await client.close();
    }
  });
});
