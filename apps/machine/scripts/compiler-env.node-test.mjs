import assert from "node:assert/strict";
import test from "node:test";

import { compilerEnv } from "./compiler-env.mjs";

const target = "x86_64-unknown-linux-musl";

void test("does not override an explicitly selected target compiler", () => {
  assert.deepEqual(compilerEnv(target, target, { TARGET_CC: "musl-gcc" }), {});
});

void test("does not override an explicitly selected host compiler", () => {
  assert.deepEqual(compilerEnv(target, target, { HOST_CC: "clang" }), {});
});

void test("keeps the fallback when no compiler was selected", () => {
  assert.deepEqual(compilerEnv(target, target, {}), {
    CC_x86_64_unknown_linux_musl: "cc",
  });
});

void test("does not set a host-target fallback for another target", () => {
  assert.deepEqual(compilerEnv("aarch64-unknown-linux-musl", target, {}), {});
});
