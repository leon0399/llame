//! The walk policy: what a tree enumeration of the daemon does not enter.

use std::{
    fs,
    path::{Path, PathBuf},
};

/// Leaf names an enumeration never enters or opens, at any depth.
pub const FIXED_SET: [&str; 5] = [".git", ".jj", ".hg", ".svn", "node_modules"];

/// Ignore matchers, each anchored at the directory that holds its file.
pub type IgnoreRules = Vec<(PathBuf, ignore::gitignore::Gitignore)>;

/// Whether the fixed set names this entry's leaf.
pub fn is_fixed(path: &Path) -> bool {
    path.file_name()
        .is_some_and(|name| FIXED_SET.iter().any(|fixed| name == *fixed))
}

/// The deepest registered root that holds `path`, or `path` itself.
pub fn registered_root<'a>(roots: &'a [PathBuf], path: &'a Path) -> &'a Path {
    roots
        .iter()
        .filter(|registered| path.starts_with(registered))
        .max_by_key(|registered| registered.components().count())
        .map_or(path, PathBuf::as_path)
}

pub fn collect_ignores(root: &Path, registered_root: &Path, rules: &mut IgnoreRules) {
    let mut ancestors = Vec::new();
    let mut dir = root.to_path_buf();
    while dir.starts_with(registered_root) {
        ancestors.push(dir.clone());
        if dir == registered_root {
            break;
        }
        if !dir.pop() {
            break;
        }
    }
    let ordered = ancestors.into_iter().rev().collect::<Vec<_>>();
    let repository = ordered
        .iter()
        .rposition(|dir| dir.join(".git").exists())
        .unwrap_or(0);
    for (index, dir) in ordered.iter().enumerate() {
        if index >= repository {
            add_ignore_file(dir, ".gitignore", rules);
        }
        add_ignore_file(dir, ".ignore", rules);
    }
}

pub fn add_ignore_files(dir: &Path, rules: &mut IgnoreRules) {
    add_ignore_file(dir, ".gitignore", rules);
    add_ignore_file(dir, ".ignore", rules);
}

fn add_ignore_file(dir: &Path, name: &str, rules: &mut IgnoreRules) {
    let file = dir.join(name);
    let Ok(metadata) = fs::symlink_metadata(&file) else {
        return;
    };
    if !metadata.is_file() {
        return;
    }
    let mut builder = ignore::gitignore::GitignoreBuilder::new(dir);
    if builder.add(&file).is_none()
        && let Ok(matcher) = builder.build()
    {
        rules.push((dir.to_path_buf(), matcher));
    }
}

pub fn ignored(
    path: &Path,
    is_dir: bool,
    rules: &[(PathBuf, ignore::gitignore::Gitignore)],
) -> bool {
    let mut ignored = false;
    for (dir, matcher) in rules {
        if !path.starts_with(dir) {
            continue;
        }
        let matched = matcher.matched(path, is_dir);
        if matched.is_ignore() {
            ignored = true;
        } else if matched.is_whitelist() {
            ignored = false;
        }
    }
    ignored
}

pub fn is_ignore_file(path: &str) -> bool {
    path.rsplit('/')
        .next()
        .is_some_and(|name| matches!(name, ".gitignore" | ".ignore"))
}
