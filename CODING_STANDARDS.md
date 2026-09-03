# CODING_STANDARDS.md

**The smallest change that fully solves the current task is the correct change.** Everything below enforces that one sentence. Code is a liability, not an asset — every line, layer, and dependency must justify its existence _today_, not in an imagined future.

## 1. Scope discipline

The most common failure is not bad code — it's unrequested code.

- Solve the task as stated. Nothing else.
- Do not refactor, rename, reformat, or "clean up" code the task doesn't require touching. Anything nearby that deserves fixing is a note, not a diff.
- Do not add features, options, or handling for cases the task doesn't mention.
- Required tenant isolation, fail-closed authorization, durability, and
  transaction safety are part of every task.
- Confine the blast radius. Regression risk scales with the code you _touch_, not the code you add: when an isolated new unit and a change threaded through shared paths would both satisfy the task, build the isolated unit — even at the cost of some duplication (§2 permits it). For example, when the ask can be one new minimalist pipeline with a new approach, don't deliver as an override woven through every existing pipeline.
- Match the surrounding code — its abstraction level, naming, error handling, idioms. Do not import a pattern the codebase doesn't use, even one you prefer. Where the surroundings themselves break these rules, don't extend the violation into new code — and don't launch a cleanup either.
- If the task is ambiguous, seems to demand a bigger design, or would be satisfied by something simpler than what was asked — say so _before_ building. Never run on an unstated assumption.

When reframing a requirement would remove substantial complexity without
changing its outcome, propose the smaller version before implementing. The
human decides; otherwise build the stated requirement.

## 2. No speculative abstraction

Do not introduce any of the following. Delete them on sight in code the task touches; found elsewhere, they're a note, not a diff (§1):

- Interfaces or abstract classes with exactly one implementation
- Strategy / factory / registry / plugin patterns over a small fixed set (use `if`/`switch`)
- `Manager`, `Orchestrator`, `Coordinator`, `Base*`, `Abstract*`, `*Helper`, `*Util` classes — judge the substance, but the default is delete
- Config objects, generics, or optional parameters with a single caller
- Extension points, hooks, or flags that nothing currently uses

**Rule of three:** duplicate freely twice. Extract only at the third real occurrence — and only if the extraction is smaller and clearer than the duplication it removes. If callers would immediately diverge again, don't.

**Single-use extraction is guilty until proven clearer.** A helper with one call site moves logic away from the only place it's used; inline it. Sometimes the elegant implementation is just a function. Not a method, not a class, not a framework.

## 3. Prefer the shallowest design

Get the data structure right first — most complexity is compensation for the wrong shape. Pick the shape that makes special cases disappear into the normal case: a conditional that exists only to guard an edge means the shape is wrong. Restructure to eliminate the edge rather than guard it.

Then: shallow _architecture_, deep _modules_. Few layers of indirection — but where a module exists, substantial behavior behind a small interface. The failure mode is the pass-through layer, never substantial code behind a small door.

- Plain data + functions over classes; a class only when state and behavior genuinely belong together.
- Direct calls over service / repository / DTO layers, unless the boundary already exists in the codebase.
- Composition over inheritance. Inheritance deeper than one level is a design error, not a style choice.
- One obvious path through the code, followable top to bottom without jumping between files.
- Boring beats clever. Code that demands extra mental effort to follow is worse than plain code that does the same thing.

## 4. Complexity trip-wires

Signals that the _design_ is wrong — not targets to game:

| Signal                                          | Threshold  |
| ----------------------------------------------- | ---------- |
| Function length (branching logic)               | > 40 lines |
| Parameters per function                         | > 4        |
| Nesting depth                                   | > 3        |
| Hops through the codebase to trace one behavior | > 4        |
| New files in a small change                     | > 2        |

Length applies to _branching_ logic: a long straight-line sequence that reads top to bottom is fine — usually better than the same steps scattered across helpers. When a wire trips, **simplify the logic — do not mechanically split it.** Carving one function into three private helpers satisfies the number while making the code worse. Never raise a threshold to pass review.

The strongest trip-wire has no number: if a straightforward implementation would be several times shorter than what you wrote, discard yours and write that one. The 100-line version beats the 1000-line version.

## 5. No unrequested robustness

- No retries, logging, metrics, caching, or feature flags beyond what the current task and its _real_ failure modes require.
- Do not _handle_ states that cannot occur — _assert_ them. An assert fails loudly and documents the invariant; a recovery path for an impossible state hides bugs.
- No new dependencies for problems the standard library or existing code already solves. A dependency is code you now ship without reading it — prefer vendoring 50 lines you understand over importing 5,000 you don't.
- No comments that narrate what the code visibly does. Comments explain _why_, and only when the why is non-obvious.

## 6. Deletion bias

- Code your change orphans — imports, parameters, functions, flags it made unused — is removed in the same change, never left "for later." Pre-existing dead code you merely noticed is a note, not a diff (§1).
- No backwards-compatibility shims or re-exports unless something real still calls the old path.
- Deletability is the test of isolation: prefer the design where a feature is as easy to remove as it was to add.
- The best diffs are often mostly red.

## 7. The whole document in two examples

```ts
// BAD — speculative abstraction
interface IUserRepository {
  get(id: string): Promise<User>;
}
class UserRepository implements IUserRepository {
  /* ... */
}
class UserService {
  constructor(
    private repo: IUserRepository,
    private opts: UserServiceOptions = {},
  ) {}
  async getUser(id: string, options?: Partial<UserServiceOptions>) {
    /* ... */
  }
}

// GOOD — the same capability
async function getUser(id: string): Promise<User> {
  return db.users.find(id);
}
```

```ts
// BAD — unrequested robustness
async function loadConfig(path = DEFAULT_PATH, retries = 3): Promise<Config> {
  for (let i = 0; i < retries; i++) {
    try {
      logger.debug(`loading config, attempt ${i + 1}`);
      return validateConfig(JSON.parse(await fs.readFile(path, "utf8")));
    } catch (err) {
      logger.warn("config load failed", err);
      if (i === retries - 1) return FALLBACK_CONFIG;
    }
  }
  return FALLBACK_CONFIG; // unreachable, "just in case"
}

// GOOD — a broken config file should fail loudly, not silently fall back
async function loadConfig(): Promise<Config> {
  return validateConfig(JSON.parse(await fs.readFile(CONFIG_PATH, "utf8")));
}
```

## 8. When complexity is earned

A plain rule-of-three extraction needs only §2. Anything more — a layer, an interface, a seam — may be added only when at least two of these are true _right now_:

- Three or more call sites share behavior that changes together
- Duplication has already caused a real bug or a repeated multi-file fix
- A genuine external boundary exists (process, network, third-party API)
- A _measured_ performance problem demands it — a profile, not a hunch
- Tests need a seam that cannot exist otherwise

Even then: add the least structure that resolves the actual pain, nothing in anticipation of the next pain.

## 9. Define done, then prove it

Before coding, restate the task as a checkable outcome: a test that fails now and must pass, a command whose output proves the change, a repro that stops reproducing. "Done" means that check passed — not that code was written, and not that you attest it works: prefer proof a machine can run over claims a reviewer must trust. Test at genuine seams — process, network, module interface — not with mocks threaded through the interior. **Tautological tests considered harmful:** a test that asserts a mock returns what the test just configured, or recomputes the expected value with the implementation's own expression, cannot fail and is worse than no test. Break the implementation and re-run — still green means it measured nothing. And done never includes breaking what already worked: regression is the one unforgivable diff.

## 10. Review gate

Reject the change if any answer is no:

1. Is this the smallest change that fully solves the stated task?
2. Does everything that worked before still work — and what proves it?
3. Could any abstraction, layer, file, or option be deleted with the requirements still met?
4. Does everything new exist for a present need, demonstrated in this diff?
5. Was code outside the task's scope left untouched?
6. Can the happy path be traced top to bottom without excessively jumping between files?

---

_These rules are intentionally strict, and this file obeys its own law: an exception is argued in the PR description — the rule does not change; a new rule earns its place by deleting an old one. When an agent proposes to "improve the design," this document is the pushback._
