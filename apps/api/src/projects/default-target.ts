import { type Checkout, type ProjectRepository } from '../db/schema';

/**
 * Why one checkout cannot be stored as the default of one project link
 * (openspec `chat-start-location`, "Project repository defaults remember the
 * last chosen checkout per executor", design D8).
 *
 * The rule spans three tables — a checkout, its repository, and its executor
 * against the link's repository — so no foreign key can state it. The writer
 * checks it before every insert or replace, and this function is the single
 * statement of the rule.
 */
export const DEFAULT_TARGET_PROBLEMS = [
  'checkout_not_found',
  'checkout_not_main',
  'checkout_repository_mismatch',
  'checkout_executor_mismatch',
] as const;

export type DefaultTargetProblem = (typeof DEFAULT_TARGET_PROBLEMS)[number];

/**
 * `null` when the checkout may be the default of the link on that executor.
 * A worktree is never a defaults target: a worktree start records the `main`
 * checkout it was cut from instead.
 */
export function defaultTargetProblem(
  checkout: Pick<Checkout, 'kind' | 'repositoryId' | 'executorId'> | undefined,
  link: Pick<ProjectRepository, 'repositoryId'>,
  executorId: string,
): DefaultTargetProblem | null {
  if (checkout === undefined) return 'checkout_not_found';
  if (checkout.kind !== 'main') return 'checkout_not_main';
  if (checkout.repositoryId !== link.repositoryId) {
    return 'checkout_repository_mismatch';
  }
  if (checkout.executorId !== executorId) return 'checkout_executor_mismatch';
  return null;
}
