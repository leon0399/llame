import { createRequire, syncBuiltinESMExports } from "node:module";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const [, , root, expected, label, resultPath] = process.argv;
const require = createRequire(import.meta.url);
const fs = require("node:fs");
if (label === "first") {
  const originalRename = fs.renameSync;
  const target = join(root, "note.txt");
  fs.renameSync = (from, to) => {
    if (to === target) {
      writeFileSync(join(root, "before-replace"), "");
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
    }
    return originalRename(from, to);
  };
}
syncBuiltinESMExports();
const { WorkspaceFiles } = await import("../dist/workspace-files.js");
const files = new WorkspaceFiles(root, []);

try {
  files.write("note.txt", `${label}\n`, expected);
  writeFileSync(resultPath, JSON.stringify({ ok: true }));
} catch (error) {
  writeFileSync(
    resultPath,
    JSON.stringify({ ok: false, code: error?.code ?? "unknown" }),
  );
}
