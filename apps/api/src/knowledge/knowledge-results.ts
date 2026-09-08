/**
 * The closed results every Knowledge surface returns, in one place so that
 * search and the `kb://` locator cannot drift apart on what an owner is told —
 * in particular on cancellation, which must propagate rather than becoming a
 * generic unavailability.
 */

import { type ToolResult } from '@workspace/runtime-safety';

import { KnowledgeFilesystemError } from './knowledge-filesystem-errors';

export function knowledgeNotConfiguredResult(): ToolResult {
  return {
    status: 'error',
    type: 'knowledge_space_not_configured',
    message: 'Knowledge Space is not configured.',
  };
}

export function knowledgeNotFoundResult(): ToolResult {
  return {
    status: 'error',
    type: 'knowledge_space_not_found',
    message: 'Knowledge Space was not found.',
  };
}

export function knowledgeUnavailableResult(): ToolResult {
  return {
    status: 'error',
    type: 'knowledge_space_unavailable',
    message: 'The Knowledge Space is unavailable.',
  };
}

export function knowledgeLimitResult(): ToolResult {
  return {
    status: 'error',
    type: 'knowledge_limit_exceeded',
    message: 'The Knowledge operation exceeded its result limit.',
  };
}

/** A cancelled operation is the caller's own abort; it is never an owner-facing
 *  result and must reach the runner as a rejection. */
export function mapKnowledgeFailure(error: unknown): ToolResult {
  if (error instanceof KnowledgeFilesystemError) {
    if (error.code === 'knowledge_cancelled') throw error;
    return { status: 'error', type: error.code, message: error.message };
  }
  return knowledgeUnavailableResult();
}

/** Binding resolution speaks only the Space vocabulary: an unusable root or
 *  child is unavailable, and nothing below it reaches the caller. */
export function mapKnowledgeResolverFailure(error: unknown): ToolResult {
  if (error instanceof KnowledgeFilesystemError) {
    if (error.code === 'knowledge_cancelled') throw error;
    if (error.code === 'knowledge_space_unavailable') {
      return knowledgeUnavailableResult();
    }
    return mapKnowledgeFailure(error);
  }
  return knowledgeUnavailableResult();
}
