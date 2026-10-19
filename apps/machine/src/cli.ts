/**
 * The process shell: argv in, exit status out. Everything worth testing —
 * command dispatch, roots handling, and the exit status a session end maps to —
 * lives in `cli-commands.ts`, so this file must never be imported by a test.
 */
import { runMain } from "./cli-commands";

void runMain(process.argv.slice(2));
