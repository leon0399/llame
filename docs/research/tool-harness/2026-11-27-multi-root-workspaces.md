---
type: Research
title: "Workspaces with several roots in agent tools"
description: "Compares multi-root workspace models, authorization, instruction discovery, model-visible root identity, and manifest-managed repository spokes."
tags:
  - agent-harness
  - workspace
  - multi-root
status: draft
summary: "Multi-root is not one shared capability: IDE workspaces aggregate roots, agent CLIs expose distinct authorization and instruction rules, while manifests provision spokes on disk. Worktrees preserve only roots that are actually present."
read_when:
  - designing multi-root Chat workspaces
  - comparing agent tools' added-directory permissions and instructions
  - deciding how a manifest-backed hub should expose repositories in worktrees
observed:
  date: 2026-11-27
  revisions:
    llame: 751bb05
sources:
  - id: claude-permissions
    resource: "https://code.claude.com/docs/en/permissions"
    title: "Claude Code permissions and working directories"
  - id: claude-memory
    resource: "https://code.claude.com/docs/en/memory"
    title: "Claude Code memory and additional directories"
  - id: codex-cli-reference
    resource: "https://developers.openai.com/codex/cli/reference"
    title: "Codex CLI command-line reference"
  - id: codex-sandbox
    resource: "https://developers.openai.com/codex/sandboxing"
    title: "Codex sandbox"
  - id: vscode-multi-root
    resource: "https://code.visualstudio.com/docs/editing/workspaces/multi-root-workspaces"
    title: "VS Code multi-root workspaces"
  - id: cursor-files
    resource: "https://docs.cursor.com/context/@-symbols/@-files-and-folders"
    title: "Cursor files and folders context"
  - id: zed-projects
    resource: "https://zed.dev/docs/windows-and-projects"
    title: "Zed windows and projects"
  - id: zed-instructions
    resource: "https://zed.dev/docs/ai/instructions"
    title: "Zed instructions"
  - id: opencode-permissions
    resource: "https://opencode.ai/docs/permissions"
    title: "OpenCode permissions"
  - id: opencode-instructions
    resource: "https://opencode.ai/docs/instructions"
    title: "OpenCode instructions"
  - id: gemini-commands
    resource: "https://geminicli.com/docs/reference/commands"
    title: "Gemini CLI commands"
  - id: gemini-configuration
    resource: "https://geminicli.com/docs/reference/configuration"
    title: "Gemini CLI configuration"
  - id: west-workspaces
    resource: "https://docs.zephyrproject.org/latest/develop/west/workspaces.html"
    title: "West workspaces"
  - id: omp-reference
    resource: "../harnesses/oh-my-pi.md"
    title: "oh-my-pi harness reference in this bundle"
---

# Workspaces with several roots in agent tools

## Summary

Multi-root can mean at least three different things: several editor folders, an agent's filesystem authorization boundary, or a manifest that provisions several repositories. These are separate capabilities. An editor can display several roots without defining agent permissions. A CLI can grant access to a directory without loading its instructions. A manifest can define repositories without integrating them into a chat's workspace.

The strongest direct fit for a Chat that binds multiple roots is VS Code-style named folders, but it does not specify agent-tool permission or instruction semantics. Among the command-line agents reviewed, Gemini CLI makes multi-directory workspace membership explicit with `/directory add` and `--include-directories`. Codex exposes additional writable roots through `--add-dir` in `workspace-write`. Claude Code adds directories for file access, but retains one primary working directory. OpenCode checks external directory boundaries independently from its active location. Zed's current interface supports multiple projects and also permits adding folder roots to one project. OMP's reviewed research reference predates its later multi-root feature; current project source should be consulted before adopting its older assumptions.

For a hub whose ignored `checkouts/<name>` disappear in a hub worktree, the worktree contains no spoke checkout to expose. A manifest can recreate or update spokes at declared paths, but the tooling must explicitly do that after worktree creation. A linked worktree of the hub does not automatically make untracked or ignored peer repositories appear there.

## Compared behavior

| Tool                      | How roots are added                                                                                                               | Primary versus added                                                                                                                              | Permission scope                                                                                                                                                                                                                  | Instructions from added roots                                                                                                                                                          | Root names/model context                                                                                                           |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Claude Code               | `--add-dir` at launch, `/add-dir` during a session, or `additionalDirectories` in settings.                                       | Launch directory remains primary until `/cd`; added directories extend access, not the primary cwd.                                               | Read-only file tools cover working and additional directories. Edit/write tools are permission checked; `acceptEdits` applies to working and additional directories. Bash separately uses command permissions and sandbox policy. | Not by default. `CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD=1` opts into loading CLAUDE.md and related instruction files from added directories.                                     | Model receives filesystem paths and primary cwd. Docs specify access boundaries, but do not define a friendly alias/name API.      |
| Codex CLI                 | `--add-dir` adds directories; config may specify sandbox writable roots.                                                          | Current working directory remains the initial workspace. Added directory is a separately authorized root.                                         | `workspace-write` permits writes in the workspace and configured writable roots. The CLI reference documents `--add-dir`; precise UI/model presentation is not documented here.                                                   | No claim that added directories' instruction files load was established from reviewed official source.                                                                                 | Roots are path-addressed; no user-defined root label documented in reviewed sources.                                               |
| VS Code `.code-workspace` | `folders` array, UI Add Folder, or `code --add`.                                                                                  | Each folder is a named workspace root; no distinguished agent primary root established by editor docs.                                            | Editor file access is not an agent authorization boundary. Extensions or agents define their own policies.                                                                                                                        | Not an agent instruction loader. `.vscode` per-folder settings may apply.                                                                                                              | `name` overrides displayed folder label; paths may be absolute or relative to the `.code-workspace` file.                          |
| Cursor `.code-workspace`  | Uses VS Code multi-root workspace format.                                                                                         | Editor workspace roots; not necessarily agent roots.                                                                                              | Workspace membership must not be inferred as an agent permission grant; Cursor agent policy is separate.                                                                                                                          | `.cursor/rules` and referenced context are Cursor-specific; evidence reviewed does not establish automatic instructions from every folder.                                             | Folder display names come from workspace metadata; Cursor @Files/Folders can supply explicit context.                              |
| Zed                       | Add Folder to Project makes it an additional root; `zed --add` adds a project to window's project sidebar (not same as one root). | Multiple projects have separate file trees, git state, search scopes and project-bound agent threads. Additional roots can belong to one project. | Docs establish project organization, not a sandbox permission boundary.                                                                                                                                                           | Zed Agent uses the current project's supported instruction-file selection, including AGENTS.md and CLAUDE.md. No evidence here that every added root contributes its instruction file. | Project identity and root path appear to be project-level; no stable model-facing custom alias contract documented.                |
| OpenCode                  | Workspace is the active location; file tools may reach external directories subject to `external_directory` policy.               | One active Location. External paths are distinct, not named workspace roots.                                                                      | Permissions include external directory boundary plus read/edit rules. Current defaults allow external directories; users can request or deny access. Shell checks inferred external paths best-effort.                            | Upward `AGENTS.md`/`CLAUDE.md` discovery follows workspace; outside project root only global instructions load.                                                                        | Current location is implicit; external paths are path-based. No alias list documented.                                             |
| Gemini CLI                | `--include-directories`, `/directory add <path>`, and `/directory show`.                                                          | Current cwd is the starting directory; included directories join multi-directory workspace context.                                               | Directory addition can be disabled in restrictive sandbox profiles. The exact resulting allowed operations depend on tool sandbox and approval configuration.                                                                     | `GEMINI.md` discovery behavior across added roots was not established from the retrieved docs. Treat as unknown, not absent.                                                           | Explicit included directory paths; docs describe workspace directories but no custom alias contract.                               |
| oh-my-pi                  | Prior harness reference describes a session cwd and mounted capabilities, not the newer multi-root change.                        | It should not be described as supporting only one root based on the older reference.                                                              | OMP tools and device mounts have their own permission gates; mount access is not equivalent to a global filesystem root.                                                                                                          | Existing root-scoped instruction behavior not resolved by the 2026-09-21 reference.                                                                                                    | Open PR #6255 adds dynamic multi-root workspace context; verify current merged source before making exact naming or prompt claims. |

## Tool findings

### Claude Code

Claude Code distinguishes its primary working directory from additional directories. The primary directory is where the session starts, until `/cd` moves it. `--add-dir`, `/add-dir`, and `additionalDirectories` extend access without changing that primary identity. Its permission docs classify file reads as allowed within the working and additional directories. Edits remain subject to tool permission mode. Bash is a separate capability and should not be equated with file-tool access. [^claude-permissions]

`CLAUDE.md` discovery follows the current directory and its ancestors, with nested files discovered as the agent works in those subdirectories. Files under additional directories are excluded by default. `CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD=1` opts into loading memory and rule files from each additional directory. This opt-in is important for repositories that expect their own instructions to accompany their source. [^claude-memory]

The current docs also describe `additionalDirectories` in settings and SDK configuration. This is a first-party filesystem grant, not evidence of an extra named project model. The model can be told where an added path is, but there is no documented alias field that renames it. [^claude-permissions][^claude-memory]

### Codex CLI

Codex CLI's `--add-dir` is a launch option for granting access to an extra directory. In `workspace-write`, Codex restricts writes to the workspace and writable roots. The official sandbox page describes the workspace-write model; the CLI reference describes the additional directory option. Therefore, `--add-dir` should be understood as extending the workspace boundary, not changing cwd. [^codex-cli-reference][^codex-sandbox]

The current official pages retrieved for this study did not establish whether Codex reads `AGENTS.md` from every `--add-dir` path, or how those roots are named in the model prompt. Do not infer either behavior from filesystem access alone. Codex's complete effective writable roots can also depend on configuration, so command-line flags alone are not a universal permissions statement. [^codex-cli-reference][^codex-sandbox]

### VS Code and Cursor

VS Code's `.code-workspace` stores an array of folder paths. Each folder can have a custom display `name`; relative paths resolve from the workspace file. It supports settings at user, workspace, and folder scope. In multi-root mode only resource settings are meaningful per-folder; global editor settings belong to workspace settings. This is an editor model with visible root identities, not an agent authorization contract. [^vscode-multi-root]

Cursor uses the same `.code-workspace` multi-root organization. Cursor's AI context tools also let a user select files and folders explicitly with `@Files & Folders`. These documented surfaces do not prove that an Agent automatically reads all folders' instruction files or that every editor root is writable by the agent. [^vscode-multi-root][^cursor-files]

### Zed

Zed currently distinguishes a window containing several projects from a project containing several folder roots. Each project has its own file tree, git state, search scope, and project-bound agent threads. The UI can also add folders to a current project, which Zed describes as similar to VS Code multi-root. [^zed-projects]

Zed Agent supports a primary project instruction file selected from recognized conventions, including AGENTS.md and CLAUDE.md. The instructions docs do not establish automatic discovery from every extra root. Do not infer authorization from the editor's root display. [^zed-instructions]

### OpenCode

OpenCode's active Location is a root for relative path resolution. A path outside the active Location and its project worktree invokes the `external_directory` permission check before read or edit rules. Its defaults allow external directories, so users who need a deny-by-default boundary must configure one. Shell authorization uses scanner-inferred directories and is explicitly best-effort. [^opencode-permissions]

OpenCode loads global instructions and instruction files from the active workspace toward the project root. If the workspace is outside the project root, only global instructions load. Its docs describe changing the instruction state when the active location changes, but do not describe a named multi-root workspace passed to the model. [^opencode-permissions][^opencode-instructions]

### Gemini CLI

Gemini CLI exposes explicit multi-directory membership through `--include-directories`, `/directory add`, and `/directory show`. Paths supplied to the slash command can be absolute, relative to the current working directory, or home-relative. The command is disabled under restrictive sandbox profiles, so multi-directory context is not a way around sandbox restrictions. [^gemini-commands]

The retrieved configuration document details project and user settings and sandbox controls, but did not settle how `GEMINI.md` is discovered from added roots. It also did not establish root aliases in the model prompt. Those are open evidence gaps, not negative findings. [^gemini-configuration]

### oh-my-pi

The supplied oh-my-pi reference is pinned to revision `d49918fab2dba3986927f2d46721629ed0f3a02c` and observed on 2026-09-21. It is a useful source for OMP tools, mounts, and permissions at that revision, but it is stale for the multi-root question. A later upstream change is recorded as merged PR #6255, titled “Add dynamic multi-root workspace context.” The available retrieved evidence establishes the existence and intent of that change only. Exact current behavior, root naming, prompts, permission checks, and instruction loading require inspection of the merged source before borrowing it. [^omp-reference]

### Hub and spoke checkouts

A hub-and-spokes manifest separates repository topology from an editor or agent's workspace model. Zephyr `west` manifests name projects, assign each a path within the workspace, and update repositories at those paths. West supports a star where the manifest repo is the hub, and a forest where a separate manifest repo lists sibling projects. [^west-workspaces]

West's workspace documentation explicitly says projects may be located anywhere inside the workspace, but may not escape it. The manifest's `path` chooses each project location. This can provide stable spoke paths such as `checkouts/api`, without making the hub Git tree own the spoke contents. [^west-workspaces]

Git submodules are different: the superproject records a gitlink to a specific submodule commit and populates it through submodule commands. A manifest is a separate declaration and checkout orchestration layer. Repository-management tools such as Google's `repo` similarly build a workspace from a manifest and place projects at declared paths. None of those mechanisms makes an ignored directory magically exist in a new hub worktree. A manifest update/checkout step must run there, or the workspace definition must reference spoke checkouts outside that worktree. **Inference, high confidence:** an ignored nested clone inside a hub worktree is not portable across worktrees unless explicitly reproduced, because Git worktrees share tracked content and index but do not version ignored nested repositories as part of the hub commit.

For multi-root products, a robust flow is therefore: materialize spokes via the manifest for each worktree, then add those actual paths to the IDE or agent context, and grant permissions independently. A stored relative path like `checkouts/api` is portable only if each checkout materializes the same layout beneath the correct hub worktree.

## Cross-cutting conclusions

- A root list answers location membership, not authorization, instructions, or prompt representation. Each must be specified separately.
- A primary root may affect cwd-relative paths, project configuration, instruction discovery, and project-level trust even when additional roots are readable.
- Folder aliases improve human disambiguation. Only the VS Code `.code-workspace` sources reviewed explicitly define a custom visible folder `name`; model-facing naming remains underdocumented for most CLIs.
- Permission boundaries should be reported per tool. Read, edit, shell, and subprocess access can have different rules.
- For hub-spoke repositories, filesystem provisioning belongs to manifest/workspace tooling. Agent multi-root support does not clone repos or restore ignored paths in worktrees.

## Confidence and limits

High confidence: Claude's primary-versus-additional distinction and opt-in additional-directory instruction loading; VS Code folder names and path resolution; Zed's multi-project versus add-folder distinction; OpenCode's external-directory permission; Gemini's directory add commands; West's project path and topology model. These are stated in current official docs reviewed on 2026-11-27.

Moderate confidence: Codex additional writable roots. Official CLI and sandbox docs establish the mechanisms, but their interaction and user-facing model representation were not directly probed in an installed CLI. Cursor root presentation uses VS Code workspace conventions, but Cursor agent permissions and instruction discovery were not established for all roots.

Low confidence or unresolved: OMP current post-PR #6255 behavior, Codex and Gemini instruction loading from added roots, and how most CLIs label roots in model-visible context. No local CLI `--help` run was used as evidence. Version numbers were not captured for vendor documentation, which updates continuously. The report intentionally distinguishes unknown behavior from unsupported behavior.

## Sources

[^claude-permissions]: [Claude Code permissions](https://code.claude.com/docs/en/permissions) describes working directories, file-tool access, permission modes, and additional directories.

[^claude-memory]: [Claude Code memory](https://code.claude.com/docs/en/claude-md) describes `CLAUDE.md` discovery, additional directories, and `CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD`.

[^codex-cli-reference]: [Codex CLI reference](https://developers.openai.com/codex/cli/reference) documents CLI flags including `--add-dir`.

[^codex-sandbox]: [Codex sandbox](https://developers.openai.com/codex/sandboxing) describes `workspace-write` and filesystem boundaries.

[^vscode-multi-root]: [VS Code multi-root workspaces](https://code.visualstudio.com/docs/editing/workspaces/multi-root-workspaces) documents `.code-workspace`, paths, names, and folder settings.

[^cursor-files]: [Cursor @Files & Folders](https://docs.cursor.com/context/@-symbols/@-files-and-folders) documents explicitly including files and folders in AI context.

[^zed-projects]: [Zed Windows & Projects](https://zed.dev/docs/windows-and-projects) describes multiple projects per window and multiple folders in one project.

[^zed-instructions]: [Zed instructions](https://zed.dev/docs/ai/instructions) describes project instruction file selection and scope.

[^opencode-permissions]: [OpenCode permissions](https://opencode.ai/docs/permissions) documents location-relative and external-directory rules.

[^opencode-instructions]: [OpenCode instructions](https://opencode.ai/docs/instructions) documents upward instruction discovery and updates.

[^gemini-commands]: [Gemini CLI commands](https://geminicli.com/docs/reference/commands) documents `/directory add` and directory listing.

[^gemini-configuration]: [Gemini CLI configuration](https://geminicli.com/docs/reference/configuration) documents settings scope and sandbox configuration.

[^west-workspaces]: [West workspaces](https://docs.zephyrproject.org/latest/develop/west/workspaces.html) describes project locations, manifest topologies, and worktree-like update behavior.

[^omp-reference]: [oh-my-pi harness reference](../harnesses/oh-my-pi.md) pins the earlier OMP source snapshot. Upstream PR [#6255](https://github.com/can1357/oh-my-pi/pull/6255) is merged and titled “Add dynamic multi-root workspace context.”
