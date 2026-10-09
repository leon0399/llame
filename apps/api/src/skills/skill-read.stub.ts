import { type UnknownRecord } from '@workspace/runtime-safety';

import { compileTestPermissionPolicy } from '../testing/tool-permission-policy';
import { nativeReadTool } from '../tools/native-files';
import { type PermissionDecision } from '../tools/permissions/types';
import { type Tool, type ToolContext, type ToolResult } from '../tools/types';
import { SkillCatalog } from './skill-catalog';

export const STUB_RUN_ID = '11111111-2222-4333-8444-555555555555';

type ReadHandler = (
  path: string,
  context: ToolContext,
) => ToolResult | Promise<ToolResult>;

/**
 * The real read tool's identity, schema, and permission declaration, with the
 * result scripted per requested path. It lets a test choose what a read returns
 * and when, which a package on disk cannot express.
 */
export function scriptedReadTool(handler: ReadHandler): Tool<{
  path: string;
}> {
  return {
    ...nativeReadTool,
    execute: (context, input) => handler(input.path, context),
  };
}

export function fileResult(
  content: string,
  extra: UnknownRecord = {},
): ToolResult {
  return { status: 'success', kind: 'file', content, ...extra };
}

/** A skill's raw `SKILL.md` read, with the envelope fields activation needs. */
export function rootResult(skill: string, body: string): ToolResult {
  return fileResult(
    `---\nname: ${skill}\ndescription: The ${skill} skill.\n---\n${body}`,
    {
      skillDirectory: `/skills/${skill}`,
      resolvedPath: `/skills/${skill}/SKILL.md`,
    },
  );
}

export function notFoundResult(): ToolResult {
  return { status: 'error', type: 'not_found', message: 'missing' };
}

type AuditRecord = {
  readonly toolCallId: string;
  readonly phase: 'requested' | 'completed';
  readonly input?: { readonly path: string };
  readonly decision?: PermissionDecision;
  readonly result?: ToolResult;
};

/** An allow-all tool context whose activation reads are recorded in `audit`. */
export function auditedContext() {
  const audit: Array<AuditRecord> = [];
  const context: ToolContext = {
    userId: 'owner',
    chatId: 'chat',
    runId: STUB_RUN_ID,
    permissionPolicy: compileTestPermissionPolicy(),
    skillCatalog: new SkillCatalog([]),
    timeoutMs: 5000,
    tenantDb: { runAs: () => Promise.reject(new Error('no database in test')) },
  };
  return {
    audit,
    context,
    activity: {
      admitted: (
        toolCallId: string,
        input: { readonly path: string },
        decision: PermissionDecision,
      ) => {
        audit.push({ toolCallId, phase: 'requested', input, decision });
      },
      completed: (toolCallId: string, result: ToolResult) => {
        audit.push({ toolCallId, phase: 'completed', result });
      },
    },
    requestedPaths: () =>
      audit.flatMap((record) =>
        record.phase === 'requested' ? [record.input?.path] : [],
      ),
  };
}
