import { defaultTargetProblem } from './default-target';

const link = { repositoryId: 'repo-a' };

describe('defaultTargetProblem', () => {
  it('accepts the main checkout of the linked repository on that executor', () => {
    expect(
      defaultTargetProblem(
        { kind: 'main', repositoryId: 'repo-a', executorId: 'host' },
        link,
        'host',
      ),
    ).toBeNull();
  });

  it('refuses a missing checkout', () => {
    expect(defaultTargetProblem(undefined, link, 'host')).toBe(
      'checkout_not_found',
    );
  });

  it('refuses a worktree checkout', () => {
    expect(
      defaultTargetProblem(
        { kind: 'worktree', repositoryId: 'repo-a', executorId: 'host' },
        link,
        'host',
      ),
    ).toBe('checkout_not_main');
  });

  it('refuses a checkout of another repository', () => {
    expect(
      defaultTargetProblem(
        { kind: 'main', repositoryId: 'repo-b', executorId: 'host' },
        link,
        'host',
      ),
    ).toBe('checkout_repository_mismatch');
  });

  it('refuses a checkout on another executor', () => {
    expect(
      defaultTargetProblem(
        { kind: 'main', repositoryId: 'repo-a', executorId: 'machine:nas' },
        link,
        'host',
      ),
    ).toBe('checkout_executor_mismatch');
  });
});
