import { describe, expect, it } from 'vitest';

import {
  createMcpToolId,
  findAsciiCaseFoldedCollisionIndexes,
  parseMcpToolId,
} from './tool-id';

describe('mcp-tool-id-v1', () => {
  it('preserves the configured server and maps the normalized remote name', () => {
    expect(createMcpToolId('Web_Server-1', 'Find／Docs')).toEqual({
      success: true,
      id: 'mcp__Web_Server-1__Find_Docs',
    });
  });

  it('normalizes with NFKC, replaces maximal unsafe runs, trims underscores, and preserves ASCII case', () => {
    expect(createMcpToolId('web', '  Ｆind…Docs///NOW  ')).toEqual({
      success: true,
      id: 'mcp__web__Find_Docs_NOW',
    });
  });

  it('trims every edge underscore while preserving interior separators', () => {
    expect(createMcpToolId('web', '__Find__Docs__')).toEqual({
      success: true,
      id: 'mcp__web__Find__Docs',
    });
  });

  it('refuses an invalid configured server id', () => {
    expect(createMcpToolId('bad__server', 'search')).toEqual({
      success: false,
      reason: 'invalid_server_id',
    });
    expect(createMcpToolId('bad/server', 'search')).toEqual({
      success: false,
      reason: 'invalid_server_id',
    });
  });

  it('refuses an empty normalized tool segment', () => {
    expect(createMcpToolId('web', '東京')).toEqual({
      success: false,
      reason: 'empty_tool_name',
    });
  });

  it('refuses an overlength id without truncation or a suffix', () => {
    expect(createMcpToolId('web', 'a'.repeat(55))).toEqual({
      success: false,
      reason: 'overlength',
    });
  });

  it('accepts an id whose serialized length is exactly 64 characters', () => {
    expect(createMcpToolId('web', 'a'.repeat(54))).toEqual({
      success: true,
      id: `mcp__web__${'a'.repeat(54)}`,
    });
  });

  it('marks every member of an ASCII-case-folded collision across sources', () => {
    expect([
      ...findAsciiCaseFoldedCollisionIndexes([
        'mcp__web__Find_Docs',
        'code_owned',
        'MCP__WEB__find_docs',
        'safe_sibling',
        'CODE_OWNED',
      ]),
    ]).toEqual([0, 1, 2, 4]);
  });

  it('does not treat distinct ASCII ids as collisions', () => {
    expect([
      ...findAsciiCaseFoldedCollisionIndexes([
        'mcp__web__search',
        'mcp__docs__search',
      ]),
    ]).toEqual([]);
  });

  it('parses a canonical generated id with the same v1 grammar', () => {
    expect(parseMcpToolId('mcp__Web_Server-1__Find_Docs')).toEqual({
      success: true,
      id: 'mcp__Web_Server-1__Find_Docs',
      serverId: 'Web_Server-1',
      toolName: 'Find_Docs',
    });
  });

  it('rejects an id without the mcp prefix as invalid format', () => {
    expect(parseMcpToolId('server__search')).toEqual({
      success: false,
      reason: 'invalid_format',
    });
  });

  it.each([
    ['mcp__web', 'invalid_format'],
    ['mcp____search', 'invalid_server_id'],
    ['mcp__bad/server__search', 'invalid_server_id'],
    ['mcp__web__Find Docs', 'noncanonical'],
    ['mcp__web__東京', 'empty_tool_name'],
    [`mcp__web__${'a'.repeat(55)}`, 'overlength'],
  ] as const)('refuses noncanonical id %s as %s', (id, reason) => {
    expect(parseMcpToolId(id)).toEqual({ success: false, reason });
  });
});
