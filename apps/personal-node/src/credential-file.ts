import { mkdir, open, rm } from "node:fs/promises";
import { dirname } from "node:path";

export async function createCredentialFile<
  Result extends { readonly credential: string },
>(path: string, issue: () => Promise<Result>): Promise<Result> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const file = await open(path, "wx", 0o600);
  let persisted = false;
  try {
    const result = await issue();
    await file.writeFile(`${result.credential}\n`, "utf8");
    await file.sync();
    persisted = true;
    return result;
  } finally {
    await file.close();
    if (!persisted) await rm(path, { force: true });
  }
}
