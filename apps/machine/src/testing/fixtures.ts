import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** A registered root, a sibling directory outside every root, and the links
 *  between them that enforcement is about. */
export type RootFixture = {
  readonly base: string;
  readonly root: string;
  readonly outside: string;
  readonly notes: string;
  readonly secret: string;
  readonly escapeLink: string;
  readonly danglingLink: string;
  readonly insideLink: string;
  cleanup(): Promise<void>;
};

export async function createRootFixture(): Promise<RootFixture> {
  const base = await mkdtemp(join(tmpdir(), "llame-machine-"));
  const root = join(base, "root");
  const outside = join(base, "outside");
  await mkdir(root);
  await mkdir(outside);
  const notes = join(root, "notes.txt");
  const secret = join(outside, "secret.txt");
  await writeFile(notes, "one\ntwo\nthree\nfour\n");
  await writeFile(secret, "outside\n");
  const escapeLink = join(root, "escape.txt");
  const danglingLink = join(root, "dangling.txt");
  const insideLink = join(root, "inside.txt");
  await symlink(secret, escapeLink);
  await symlink(join(outside, "missing.txt"), danglingLink);
  await symlink(notes, insideLink);
  return {
    base,
    root,
    outside,
    notes,
    secret,
    escapeLink,
    danglingLink,
    insideLink,
    cleanup: async () => {
      await rm(base, { recursive: true, force: true });
    },
  };
}
