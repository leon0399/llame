/**
 * Model admission of a git entry (openspec `workspace-git-state`): `read` must
 * be in `tools.allowed`, and the attempt's read admission must admit the entry
 * path as the `path` value. The `bash` group is never consulted.
 */
export function modelGitAdmission(input: {
  readonly readAllowlisted: boolean;
  readonly admitsRead: (path: string) => boolean;
}): (gitEntry: string) => boolean {
  return (gitEntry) => input.readAllowlisted && input.admitsRead(gitEntry);
}
