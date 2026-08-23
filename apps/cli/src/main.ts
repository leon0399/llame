#!/usr/bin/env node
import { runCli } from "./cli";

runCli(process.argv.slice(2), process.env).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`llame: ${message}\n`);
    process.exitCode = 1;
  },
);
