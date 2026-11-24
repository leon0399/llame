//! Atomic `WriteFile` and exact `ReplaceText` operations.

use std::{
    fs::{self, OpenOptions},
    io::{self, Write},
    os::unix::fs::{MetadataExt, OpenOptionsExt, PermissionsExt},
    path::Path,
    sync::atomic::{AtomicU64, Ordering},
    sync::{LazyLock, Mutex},
};

use machine_core::{Context, refusal};
use machine_protocol::v1::{
    AmbiguousText, FileFailure, FileFailureReason, Occurrence, ReplaceTextRequest,
    ReplaceTextResponse, Replaced, WriteFileRequest, WriteFileResponse, WriteMode, Written,
    file_failure, replace_text_response, write_file_response,
};
use tonic::Status;

static MUTATIONS: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));
static TEMP_SEQUENCE: AtomicU64 = AtomicU64::new(0);

fn failure(
    reason: FileFailureReason,
    message: impl Into<String>,
    details: Option<file_failure::Details>,
) -> FileFailure {
    FileFailure {
        reason: reason as i32,
        message: message.into(),
        details,
    }
}

fn file_failure(reason: FileFailureReason, message: impl Into<String>) -> WriteFileResponse {
    WriteFileResponse {
        result: Some(write_file_response::Result::Failure(failure(
            reason, message, None,
        ))),
    }
}

fn replace_failure(
    reason: FileFailureReason,
    message: impl Into<String>,
    details: Option<file_failure::Details>,
) -> ReplaceTextResponse {
    ReplaceTextResponse {
        result: Some(replace_text_response::Result::Failure(failure(
            reason, message, details,
        ))),
    }
}

/// The most occurrences an ambiguity names, and the widest excerpt line.
const MAX_OCCURRENCES: usize = 10;
const MAX_EXCERPT_LINE_BYTES: usize = 200;

/// Where `old` occurs in `text`, each with its lines and one line of context.
fn ambiguous_text(text: &str, positions: &[usize], old_len: usize) -> AmbiguousText {
    let lines: Vec<&str> = text.split('\n').collect();
    let line_of = |offset: usize| text[..offset].bytes().filter(|b| *b == b'\n').count();
    let occurrences = positions
        .iter()
        .take(MAX_OCCURRENCES)
        .map(|&position| {
            let first = line_of(position);
            let last = line_of(position + old_len.saturating_sub(1));
            let start = first.saturating_sub(1);
            let end = (last + 1).min(lines.len().saturating_sub(1));
            let excerpt = lines[start..=end]
                .iter()
                .map(|line| {
                    let cut = line
                        .char_indices()
                        .map(|(i, _)| i)
                        .find(|i| *i > MAX_EXCERPT_LINE_BYTES);
                    cut.map_or_else(|| (*line).to_owned(), |i| line[..i].to_owned())
                })
                .collect();
            Occurrence {
                line: first as u32 + 1,
                excerpt,
            }
        })
        .collect();
    AmbiguousText {
        count: positions.len().min(u32::MAX as usize) as u32,
        occurrences,
    }
}

#[allow(clippy::wildcard_enum_match_arm)]
fn io_reason(error: &io::Error) -> FileFailureReason {
    match error.kind() {
        io::ErrorKind::NotFound => FileFailureReason::NotFound,
        io::ErrorKind::AlreadyExists => FileFailureReason::AlreadyExists,
        io::ErrorKind::IsADirectory | io::ErrorKind::NotADirectory => FileFailureReason::WrongKind,
        _ => FileFailureReason::Io,
    }
}

#[allow(clippy::naive_bytecount)]
fn line_count(bytes: &[u8]) -> u32 {
    if bytes.is_empty() {
        return 0;
    }
    let breaks = bytes.iter().filter(|b| **b == b'\n').count();
    (breaks + usize::from(bytes.last() != Some(&b'\n'))) as u32
}

fn create_parents(context: &Context, parent: &Path) -> Result<(), Status> {
    let guard = context.guard();
    let root = guard
        .roots()
        .iter()
        .filter(|root| parent.starts_with(root))
        .max_by_key(|root| root.components().count())
        .ok_or_else(refusal::path_not_registered)?;
    let mut current = root.clone();
    for component in parent
        .strip_prefix(root)
        .map_err(|_| refusal::path_not_registered())?
        .components()
    {
        current.push(component);
        match fs::create_dir(&current) {
            Ok(()) => {
                guard.resolve(&current.to_string_lossy())?;
            }
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {
                let meta =
                    fs::symlink_metadata(&current).map_err(|_| refusal::path_not_registered())?;
                if !meta.is_dir() || meta.file_type().is_symlink() {
                    return Err(refusal::path_not_registered());
                }
                guard.resolve(&current.to_string_lossy())?;
            }
            Err(error) => return Err(refusal::invalid_argument(error.to_string())),
        }
    }
    Ok(())
}
/// Return whether publication completed. A failure syncing the containing directory is ambiguous.
fn publish(
    path: &Path,
    content: &[u8],
    create: bool,
    mode: Option<u32>,
) -> Result<(), (FileFailureReason, String)> {
    let parent = path.parent().unwrap_or_else(|| Path::new("/"));
    let name = format!(
        ".machine-{}-{}.tmp",
        std::process::id(),
        TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed)
    );
    let temp = parent.join(name);
    let mut options = OpenOptions::new();
    options
        .write(true)
        .create_new(true)
        .mode(mode.unwrap_or(0o666));
    let mut file = options
        .open(&temp)
        .map_err(|e| (io_reason(&e), e.to_string()))?;
    let prepared = (|| {
        file.write_all(content)?;
        if let Some(mode) = mode {
            fs::set_permissions(&temp, fs::Permissions::from_mode(mode))?;
        }
        file.sync_all()?;
        drop(file);
        if create {
            fs::hard_link(&temp, path)?;
        } else {
            fs::rename(&temp, path)?;
        }
        Ok::<(), io::Error>(())
    })();
    let _ = fs::remove_file(&temp);
    prepared.map_err(|e| (io_reason(&e), e.to_string()))?;
    fs::File::open(parent)
        .and_then(|directory| directory.sync_all())
        .map_err(|e| (FileFailureReason::OutcomeUnknown, e.to_string()))
}

#[allow(clippy::unused_async)]
pub async fn write(
    context: &Context,
    request: WriteFileRequest,
) -> Result<WriteFileResponse, Status> {
    if request.mode != WriteMode::Create as i32
        && request.mode != WriteMode::Replace as i32
        && request.mode != WriteMode::CreateOrReplace as i32
    {
        return Err(refusal::invalid_argument("Write mode is invalid."));
    }
    let guarded = context.guard().resolve(&request.path)?;

    let _lock = MUTATIONS
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let target = &guarded.path;
    if request.create_parents
        && let Some(parent) = target.parent()
    {
        create_parents(context, parent)?;
    }
    let exists = match fs::symlink_metadata(target) {
        Ok(_) => true,
        Err(error) if error.kind() == io::ErrorKind::NotFound => false,
        Err(error) => return Ok(file_failure(io_reason(&error), error.to_string())),
    };
    if request.mode == WriteMode::Create as i32 && exists {
        return Ok(file_failure(
            FileFailureReason::AlreadyExists,
            "The target already exists.",
        ));
    }
    if request.mode == WriteMode::Replace as i32 && !exists {
        return Ok(file_failure(
            FileFailureReason::NotFound,
            "The target does not exist.",
        ));
    }
    if exists {
        let meta = match fs::metadata(&guarded.canonical) {
            Ok(metadata) => metadata,
            Err(error) => {
                context.guard().verify_unchanged(&guarded)?;
                return Ok(file_failure(io_reason(&error), error.to_string()));
            }
        };
        if !meta.is_file() {
            return Ok(file_failure(
                FileFailureReason::WrongKind,
                "The target is not a regular file.",
            ));
        }
        // A link path resolves to its target; rename over the resolved path to keep the link intact.
        let path = if guarded.is_link {
            &guarded.canonical
        } else {
            target
        };
        let mode = meta.mode() & 0o777;
        match publish(path, &request.content, false, Some(mode)) {
            Ok(()) => {}
            Err((reason, message)) => {
                context.guard().verify_unchanged(&guarded)?;
                return Ok(file_failure(reason, message));
            }
        }
        context.guard().verify_unchanged(&guarded)?;
        Ok(WriteFileResponse {
            result: Some(write_file_response::Result::Written(Written {
                created: false,
                size: request.content.len() as u64,
            })),
        })
    } else {
        if let Some(parent) = target.parent()
            && !fs::metadata(parent).is_ok_and(|meta| meta.is_dir())
        {
            return Ok(file_failure(
                FileFailureReason::NotFound,
                "The parent directory does not exist.",
            ));
        }
        match publish(target, &request.content, true, None) {
            Ok(()) => {}
            Err((reason, message)) => {
                context.guard().verify_unchanged(&guarded)?;
                return Ok(file_failure(reason, message));
            }
        }
        context.guard().verify_unchanged(&guarded)?;
        Ok(WriteFileResponse {
            result: Some(write_file_response::Result::Written(Written {
                created: true,
                size: request.content.len() as u64,
            })),
        })
    }
}

#[allow(clippy::unused_async)]
pub async fn replace(
    context: &Context,
    request: ReplaceTextRequest,
) -> Result<ReplaceTextResponse, Status> {
    if request.old_text.is_empty() {
        return Err(refusal::invalid_argument("old_text must not be empty."));
    }
    let guarded = context.guard().resolve(&request.path)?;
    let _lock = MUTATIONS
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let meta = match fs::metadata(&guarded.canonical) {
        Ok(meta) if meta.is_file() => meta,
        Ok(_) => {
            context.guard().verify_unchanged(&guarded)?;
            return Ok(replace_failure(
                FileFailureReason::WrongKind,
                "The path is not a regular file.",
                None,
            ));
        }
        Err(error) => {
            context.guard().verify_unchanged(&guarded)?;
            return Ok(replace_failure(io_reason(&error), error.to_string(), None));
        }
    };
    let source = match fs::read(&guarded.canonical) {
        Ok(bytes) => bytes,
        Err(error) => {
            context.guard().verify_unchanged(&guarded)?;
            return Ok(replace_failure(io_reason(&error), error.to_string(), None));
        }
    };
    let Ok(text) = std::str::from_utf8(&source) else {
        context.guard().verify_unchanged(&guarded)?;
        return Ok(replace_failure(
            FileFailureReason::NotUtf8,
            "The file is not valid UTF-8.",
            None,
        ));
    };
    let old = request.old_text.as_bytes();
    let positions: Vec<usize> = source
        .windows(old.len())
        .enumerate()
        .filter_map(|(i, window)| (window == old).then_some(i))
        .collect();
    if positions.is_empty() {
        context.guard().verify_unchanged(&guarded)?;
        return Ok(replace_failure(
            FileFailureReason::TextNotFound,
            "The old text was not found.",
            None,
        ));
    }
    if positions.len() != 1 {
        context.guard().verify_unchanged(&guarded)?;
        return Ok(replace_failure(
            FileFailureReason::TextAmbiguous,
            "The old text occurs more than once.",
            Some(file_failure::Details::AmbiguousText(ambiguous_text(
                text,
                &positions,
                old.len(),
            ))),
        ));
    }
    let position = positions[0];
    let mut output = Vec::with_capacity(source.len() - old.len() + request.new_text.len());
    output.extend_from_slice(&source[..position]);
    output.extend_from_slice(request.new_text.as_bytes());
    output.extend_from_slice(&source[position + old.len()..]);
    let start_line = text[..position]
        .bytes()
        .filter(|byte| *byte == b'\n')
        .count() as u32
        + 1;
    let result = publish(
        &guarded.canonical,
        &output,
        false,
        Some(meta.mode() & 0o777),
    );
    context.guard().verify_unchanged(&guarded)?;
    if let Err((reason, message)) = result {
        return Ok(replace_failure(reason, message, None));
    }
    Ok(ReplaceTextResponse {
        result: Some(replace_text_response::Result::Replaced(Replaced {
            start_line,
            line_count: line_count(&output),
        })),
    })
}
