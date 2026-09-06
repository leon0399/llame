import { resolve, join } from "node:path";
import { packageStandalone } from "./package-tree.mjs";

const cli = resolve(import.meta.dirname, "..");
process.stdout.write(packageStandalone(cli, join(cli, "standalone")) + "\n");
