use std::{
    fs,
    io::{Read, Seek, SeekFrom},
    os::unix::fs::MetadataExt,
    path::Path,
};

use machine_core::Context;
use machine_protocol::v1::{
    Directory, Entry, EntryKind, FileFailure, FileFailureReason, GetEntryResponse,
    ListDirectoryResponse, ReadBytesResponse, ReadLinesResponse, get_entry_response,
    list_directory_response, read_bytes_response, read_lines_response,
};
use prost_types::Timestamp;
use tonic::Status;

const DEFAULT_LINES_BYTES: usize = 4 * 1024 * 1024;
const DEFAULT_DIRECTORY_LIMIT: usize = 1000;
const MAX_DIRECTORY_ENTRIES: usize = 100_000;
const BYTE_CHUNK: usize = 512 * 1024;

fn failure(reason: FileFailureReason, message: impl Into<String>) -> FileFailure {
    FileFailure {
        reason: reason as i32,
        message: message.into(),
        details: None,
    }
}

fn kind(metadata: &fs::Metadata) -> EntryKind {
    let ty = metadata.file_type();
    if ty.is_symlink() {
        EntryKind::Symlink
    } else if ty.is_file() {
        EntryKind::File
    } else if ty.is_dir() {
        EntryKind::Directory
    } else {
        EntryKind::Other
    }
}

fn modified(metadata: &fs::Metadata) -> Option<Timestamp> {
    Some(Timestamp {
        seconds: metadata.mtime(),
        nanos: metadata.mtime_nsec().try_into().ok()?,
    })
}

fn make_entry(context: &Context, path: &Path, name: String) -> Result<Entry, std::io::Error> {
    let metadata = fs::symlink_metadata(path)?;
    let entry_kind = kind(&metadata);
    let (link_target, target_kind) = if metadata.file_type().is_symlink() {
        let target = context.guard().resolve(&path.to_string_lossy()).ok();
        let target_kind = target
            .as_ref()
            .and_then(|guarded| fs::metadata(&guarded.canonical).ok())
            .map_or(EntryKind::Unspecified as i32, |m| kind(&m) as i32);
        let link_target = target
            .and_then(|_| fs::read_link(path).ok())
            .map(|p| p.to_string_lossy().into_owned());
        (link_target, Some(target_kind))
    } else {
        (None, None)
    };
    Ok(Entry {
        name,
        kind: entry_kind as i32,
        size: metadata.is_file().then_some(metadata.len()),
        modified_at: modified(&metadata),
        link_target,
        target_kind,
    })
}

fn failure_response(reason: FileFailureReason, message: impl Into<String>) -> GetEntryResponse {
    GetEntryResponse {
        result: Some(get_entry_response::Result::Failure(failure(
            reason, message,
        ))),
    }
}

pub fn get_entry(context: &Context, path: &str) -> Result<GetEntryResponse, Status> {
    let guarded = context.guard().resolve(path)?;
    let response = match make_entry(
        context,
        &guarded.path,
        guarded.path.to_string_lossy().into_owned(),
    ) {
        Ok(entry) => GetEntryResponse {
            result: Some(get_entry_response::Result::Entry(entry)),
        },
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            failure_response(FileFailureReason::NotFound, error.to_string())
        }
        Err(error) => failure_response(FileFailureReason::Io, error.to_string()),
    };
    context.guard().verify_unchanged(&guarded)?;
    Ok(response)
}

pub fn list_directory(
    context: &Context,
    path: &str,
    offset: u32,
    limit: u32,
) -> Result<ListDirectoryResponse, Status> {
    let guarded = context.guard().resolve(path)?;
    let result = (|| {
        let metadata = fs::metadata(&guarded.canonical)
            .map_err(|e| (FileFailureReason::NotFound, e.to_string()))?;
        if !metadata.is_dir() {
            return Err((
                FileFailureReason::WrongKind,
                "The path is not a directory.".into(),
            ));
        }
        let iter =
            fs::read_dir(&guarded.canonical).map_err(|e| (FileFailureReason::Io, e.to_string()))?;
        let mut paths = Vec::new();
        for item in iter {
            let item = item.map_err(|e| (FileFailureReason::Io, e.to_string()))?;
            paths.push(item.path());
            if paths.len() > MAX_DIRECTORY_ENTRIES {
                return Err((
                    FileFailureReason::DirectoryTooLarge,
                    "The directory exceeds 100000 entries.".into(),
                ));
            }
        }
        paths.sort_by(|a, b| a.file_name().cmp(&b.file_name()));
        let total = paths.len();
        let start = (offset as usize).min(total);
        let count = if limit == 0 {
            DEFAULT_DIRECTORY_LIMIT
        } else {
            limit as usize
        };
        let mut entries = Vec::with_capacity(count.min(total - start));
        for item in &paths[start..total.min(start.saturating_add(count))] {
            let name = item
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .into_owned();
            entries.push(
                make_entry(context, item, name)
                    .map_err(|e| (FileFailureReason::Io, e.to_string()))?,
            );
        }
        Ok(Directory {
            entries,
            total: total as u32,
        })
    })();
    context.guard().verify_unchanged(&guarded)?;
    let result = match result {
        Ok(directory) => list_directory_response::Result::Directory(directory),
        Err((reason, message)) => {
            list_directory_response::Result::Failure(failure(reason, message))
        }
    };
    Ok(ListDirectoryResponse {
        result: Some(result),
    })
}

#[allow(clippy::too_many_lines)]
pub fn read_lines(
    context: &Context,
    path: &str,
    start_line: u32,
    limit: u32,
    max_bytes: u64,
) -> Result<ReadLinesResponse, Status> {
    let guarded = context.guard().resolve(path)?;
    let result = (|| {
        let metadata = fs::metadata(&guarded.canonical)
            .map_err(|e| (FileFailureReason::NotFound, e.to_string()))?;
        if !metadata.is_file() {
            return Err((
                FileFailureReason::WrongKind,
                "The path is not a regular file.".into(),
            ));
        }
        let first_requested = start_line.max(1) as usize - 1;
        let cap = if limit == 0 {
            usize::MAX
        } else {
            limit as usize
        };
        let requested_end = first_requested.saturating_add(cap);
        let bound = if max_bytes == 0 {
            DEFAULT_LINES_BYTES
        } else {
            usize::try_from(max_bytes).unwrap_or(usize::MAX)
        };
        let mut file = fs::File::open(&guarded.canonical)
            .map_err(|e| (FileFailureReason::Io, e.to_string()))?;
        let mut chunk = [0u8; 8192];
        let mut utf8_pending = Vec::with_capacity(4);
        let mut line = Vec::new();
        let mut lines = Vec::new();
        let mut line_ending = "";
        let mut line_count = 0usize;
        let mut used = 0usize;
        let mut truncated = false;
        let mut output_stopped = false;
        let mut last_was_newline = false;
        let mut line_too_large = false;
        let mut line_ends_cr = false;
        let mut saw_any_byte = false;
        loop {
            let read = file
                .read(&mut chunk)
                .map_err(|e| (FileFailureReason::Io, e.to_string()))?;
            if read == 0 {
                if !saw_any_byte {
                    break;
                }
                if !utf8_pending.is_empty() {
                    return Err((
                        FileFailureReason::NotUtf8,
                        "The file is not valid UTF-8.".into(),
                    ));
                }
                if !last_was_newline {
                    let source = std::str::from_utf8(&line).map_err(|_| {
                        (
                            FileFailureReason::NotUtf8,
                            "The file is not valid UTF-8.".into(),
                        )
                    })?;
                    if !output_stopped
                        && line_count >= first_requested
                        && line_count < requested_end
                    {
                        if line_too_large || source.len() > bound.saturating_sub(used) {
                            truncated = true;
                        } else {
                            lines.push(source.to_owned());
                        }
                    }
                    line_count += 1;
                }
                break;
            }
            saw_any_byte = true;
            utf8_pending.extend_from_slice(&chunk[..read]);
            match std::str::from_utf8(&utf8_pending) {
                Ok(_) => utf8_pending.clear(),
                Err(error) => {
                    let valid = error.valid_up_to();
                    if error.error_len().is_some() {
                        return Err((
                            FileFailureReason::NotUtf8,
                            "The file is not valid UTF-8.".into(),
                        ));
                    }
                    utf8_pending.drain(..valid);
                }
            }
            for &byte in &chunk[..read] {
                if byte == b'\n' {
                    let crlf = line_ends_cr;
                    if line_ending.is_empty() {
                        line_ending = if crlf { "\r\n" } else { "\n" };
                    }
                    if crlf && !line_too_large {
                        line.pop();
                    }
                    line_ends_cr = false;
                    if !output_stopped
                        && line_count >= first_requested
                        && line_count < requested_end
                    {
                        if line_too_large || line.len() > bound.saturating_sub(used) {
                            truncated = true;
                            output_stopped = true;
                        } else {
                            used += line.len();
                            lines.push(String::from_utf8(std::mem::take(&mut line)).map_err(
                                |_| {
                                    (
                                        FileFailureReason::NotUtf8,
                                        "The file is not valid UTF-8.".into(),
                                    )
                                },
                            )?);
                        }
                    }
                    line.clear();
                    line_too_large = false;
                    line_count += 1;
                    last_was_newline = true;
                } else {
                    line_ends_cr = byte == b'\r';
                    last_was_newline = false;
                    if line_count >= first_requested && !line_too_large && !output_stopped {
                        let remaining = bound.saturating_sub(used);
                        if line.len() < remaining || (byte == b'\r' && line.len() == remaining) {
                            line.push(byte);
                        } else {
                            line.clear();
                            line_too_large = true;
                        }
                    }
                }
            }
        }
        Ok(machine_protocol::v1::Lines {
            lines,
            start_line: (first_requested.min(line_count) + 1) as u32,
            line_count: line_count as u32,
            truncated,
            line_ending: line_ending.into(),
        })
    })();
    context.guard().verify_unchanged(&guarded)?;
    let result = match result {
        Ok(lines) => read_lines_response::Result::Lines(lines),
        Err((reason, message)) => read_lines_response::Result::Failure(failure(reason, message)),
    };
    Ok(ReadLinesResponse {
        result: Some(result),
    })
}

#[allow(clippy::too_many_lines)]
pub async fn read_bytes(
    context: &Context,
    path: &str,
    offset: u64,
    limit: u64,
) -> Result<tokio_stream::wrappers::ReceiverStream<Result<ReadBytesResponse, Status>>, Status> {
    let guarded = context.guard().resolve(path)?;
    let (sender, receiver) = tokio::sync::mpsc::channel(4);
    let metadata = match fs::metadata(&guarded.canonical) {
        Ok(meta) if meta.is_file() => meta,
        Ok(_) => {
            let _ = sender
                .send(Ok(ReadBytesResponse {
                    result: Some(read_bytes_response::Result::Failure(failure(
                        FileFailureReason::WrongKind,
                        "The path is not a regular file.",
                    ))),
                }))
                .await;
            return Ok(tokio_stream::wrappers::ReceiverStream::new(receiver));
        }
        Err(e) => {
            let reason = if e.kind() == std::io::ErrorKind::NotFound {
                FileFailureReason::NotFound
            } else {
                FileFailureReason::Io
            };
            let _ = sender
                .send(Ok(ReadBytesResponse {
                    result: Some(read_bytes_response::Result::Failure(failure(
                        reason,
                        e.to_string(),
                    ))),
                }))
                .await;
            return Ok(tokio_stream::wrappers::ReceiverStream::new(receiver));
        }
    };
    let size = metadata.len();
    let verify_guard = context.guard();
    tokio::spawn(async move {
        if sender
            .send(Ok(ReadBytesResponse {
                result: Some(read_bytes_response::Result::Size(size)),
            }))
            .await
            .is_err()
        {
            return;
        }
        let mut file = match fs::File::open(&guarded.canonical) {
            Ok(file) => file,
            Err(error) => {
                let _ = sender
                    .send(Ok(ReadBytesResponse {
                        result: Some(read_bytes_response::Result::Failure(failure(
                            FileFailureReason::Io,
                            error.to_string(),
                        ))),
                    }))
                    .await;
                return;
            }
        };
        let start = offset.min(size);
        let end = if limit == 0 {
            size
        } else {
            size.min(start.saturating_add(limit))
        };
        if let Err(error) = file.seek(SeekFrom::Start(start)) {
            let _ = sender
                .send(Ok(ReadBytesResponse {
                    result: Some(read_bytes_response::Result::Failure(failure(
                        FileFailureReason::Io,
                        error.to_string(),
                    ))),
                }))
                .await;
            return;
        }
        let mut remaining = end - start;
        while remaining > 0 {
            let mut buffer = vec![0; BYTE_CHUNK.min(remaining as usize)];
            let read = match file.read(&mut buffer) {
                Ok(0) => {
                    let _ = sender
                        .send(Ok(ReadBytesResponse {
                            result: Some(read_bytes_response::Result::Failure(failure(
                                FileFailureReason::OutcomeUnknown,
                                "The file changed while it was being read.",
                            ))),
                        }))
                        .await;
                    return;
                }
                Ok(read) => read,
                Err(error) => {
                    let _ = sender
                        .send(Ok(ReadBytesResponse {
                            result: Some(read_bytes_response::Result::Failure(failure(
                                FileFailureReason::Io,
                                error.to_string(),
                            ))),
                        }))
                        .await;
                    return;
                }
            };
            buffer.truncate(read);
            remaining -= read as u64;
            if sender
                .send(Ok(ReadBytesResponse {
                    result: Some(read_bytes_response::Result::Chunk(buffer)),
                }))
                .await
                .is_err()
            {
                return;
            }
        }
        if let Err(status) = verify_guard.verify_unchanged(&guarded) {
            let _ = sender.send(Err(status)).await;
        }
    });
    Ok(tokio_stream::wrappers::ReceiverStream::new(receiver))
}
