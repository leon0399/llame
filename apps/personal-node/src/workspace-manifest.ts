import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";

import { z } from "zod";

import type { WorkspaceDefinition } from "./workspace-registry.js";

const workspaceDefinitionSchema = z.strictObject({
  id: z
    .string()
    .min(1)
    .max(200)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/),
  label: z.string().min(1).max(200),
  rootPath: z.string().refine(isAbsolute, "Workspace root must be absolute"),
  entryPolicy: z.enum(["auto-approve", "ask"]),
  recoveryPolicy: z.enum(["ask", "wait", "fallback", "exit"]),
});

export async function loadWorkspaceManifest(
  path: string,
): Promise<readonly WorkspaceDefinition[]> {
  let input: unknown;
  try {
    input = JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch {
    throw new Error("Workspace manifest must contain valid JSON");
  }
  return z.array(workspaceDefinitionSchema).min(1).parse(input);
}
