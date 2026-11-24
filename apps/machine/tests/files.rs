#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::wildcard_enum_match_arm,
    clippy::too_many_lines
)]

mod common;

use machine_protocol::v1::{
    EntryKind, FileFailureReason, GetEntryRequest, ListDirectoryRequest, ReadBytesRequest,
    ReadLinesRequest, ReplaceTextRequest, WriteFileRequest, WriteMode, file_failure,
    file_service_client::FileServiceClient, get_entry_response, list_directory_response,
    read_bytes_response, read_lines_response, replace_text_response, write_file_response,
};
use tonic::Code;

#[tokio::test]
async fn reads_windows_crlf_byte_bounds_and_streamed_ranges() {
    let machine = common::Machine::new();
    let root = machine.root();
    let file = root.join("lines.txt");
    std::fs::write(&file, b"one\r\ntwo-long\r\nthree\r\n").unwrap();
    let (_child, channel) = machine.attach().await;
    let mut client = FileServiceClient::new(channel);
    let path = file.to_string_lossy().into_owned();

    let response = client
        .read_lines(ReadLinesRequest {
            path: path.clone(),
            start_line: 2,
            limit: 1,
            max_bytes: 0,
        })
        .await
        .unwrap()
        .into_inner();
    let Some(read_lines_response::Result::Lines(lines)) = response.result else {
        panic!("lines read failed");
    };
    assert_eq!(lines.lines, ["two-long"]);
    assert_eq!(lines.start_line, 2);
    assert_eq!(lines.line_count, 3);
    assert_eq!(lines.line_ending, "\r\n");

    let response = client
        .read_lines(ReadLinesRequest {
            path: path.clone(),
            start_line: 1,
            limit: 0,
            max_bytes: 5,
        })
        .await
        .unwrap()
        .into_inner();
    let Some(read_lines_response::Result::Lines(lines)) = response.result else {
        panic!("bounded lines read failed");
    };
    assert_eq!(lines.lines, ["one"]);
    assert!(lines.truncated);
    let invalid = root.join("invalid.txt");
    std::fs::write(&invalid, [0xff, 0xfe]).unwrap();
    let response = client
        .read_lines(ReadLinesRequest {
            path: invalid.to_string_lossy().into_owned(),
            start_line: 1,
            limit: 0,
            max_bytes: 0,
        })
        .await
        .unwrap()
        .into_inner();
    assert!(
        matches!(response.result, Some(read_lines_response::Result::Failure(failure)) if failure.reason == FileFailureReason::NotUtf8 as i32)
    );

    let mut stream = client
        .read_bytes(ReadBytesRequest {
            path,
            offset: 5,
            limit: 4,
        })
        .await
        .unwrap()
        .into_inner();
    assert!(matches!(
        stream.message().await.unwrap().unwrap().result,
        Some(read_bytes_response::Result::Size(22))
    ));
    assert!(
        matches!(stream.message().await.unwrap().unwrap().result, Some(read_bytes_response::Result::Chunk(bytes)) if bytes == b"two-")
    );
    assert!(stream.message().await.unwrap().is_none());
}
#[tokio::test]
async fn entries_and_directory_listing_preserve_link_facts_and_order() {
    let machine = common::Machine::new();
    let root = machine.root();
    std::fs::write(root.join("a.txt"), "a").unwrap();
    std::fs::write(root.join("b.txt"), "b").unwrap();
    std::os::unix::fs::symlink(root.join("a.txt"), root.join("inside-link")).unwrap();
    std::os::unix::fs::symlink("/etc/passwd", root.join("outside-link")).unwrap();
    std::os::unix::fs::symlink(root.join("missing"), root.join("dangling-link")).unwrap();
    let (_child, channel) = machine.attach().await;
    let mut client = FileServiceClient::new(channel);
    let response = client
        .list_directory(ListDirectoryRequest {
            path: root.to_string_lossy().into_owned(),
            offset: 1,
            limit: 3,
        })
        .await
        .unwrap()
        .into_inner();
    let Some(list_directory_response::Result::Directory(directory)) = response.result else {
        panic!("listing failed");
    };
    assert_eq!(directory.total, 5);
    assert_eq!(
        directory
            .entries
            .iter()
            .map(|e| e.name.as_str())
            .collect::<Vec<_>>(),
        ["b.txt", "dangling-link", "inside-link"]
    );
    assert_eq!(
        directory.entries[1].target_kind,
        Some(EntryKind::Unspecified as i32)
    );
    assert_eq!(
        directory.entries[2].target_kind,
        Some(EntryKind::File as i32)
    );
    let response = client
        .get_entry(GetEntryRequest {
            path: root.join("inside-link").to_string_lossy().into_owned(),
        })
        .await
        .unwrap()
        .into_inner();
    let Some(get_entry_response::Result::Entry(entry)) = response.result else {
        panic!("entry lookup failed");
    };
    assert_eq!(entry.kind, EntryKind::Symlink as i32);
    assert_eq!(
        entry.link_target.as_deref(),
        Some(root.join("a.txt").to_string_lossy().as_ref())
    );
}

#[tokio::test]
async fn mutations_apply_modes_once_and_report_exact_replacement_results() {
    let machine = common::Machine::new();
    let root = machine.root();
    let (_child, channel) = machine.attach().await;
    let mut client = FileServiceClient::new(channel);
    let file = root.join("nested/child/target.txt");
    let make_request = |request_id: &str, content: &[u8], mode| WriteFileRequest {
        request_id: request_id.into(),
        path: file.to_string_lossy().into_owned(),
        content: content.into(),
        mode,
        create_parents: true,
    };
    let first_request = make_request(
        "create-once",
        b"before\nold\nafter\n",
        WriteMode::Create as i32,
    );
    let first = client
        .write_file(first_request.clone())
        .await
        .unwrap()
        .into_inner();
    let resent = client.write_file(first_request).await.unwrap().into_inner();
    assert_eq!(first, resent);
    assert!(
        matches!(first.result, Some(write_file_response::Result::Written(written)) if written.created)
    );
    std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o640)).unwrap();

    let replaced = client
        .write_file(make_request(
            "replace",
            b"rewritten",
            WriteMode::Replace as i32,
        ))
        .await
        .unwrap()
        .into_inner();
    assert!(
        matches!(replaced.result, Some(write_file_response::Result::Written(written)) if !written.created && written.size == 9)
    );
    assert_eq!(std::fs::metadata(&file).unwrap().mode() & 0o777, 0o640);
    let exists = client
        .write_file(make_request(
            "create-existing",
            b"no",
            WriteMode::Create as i32,
        ))
        .await
        .unwrap()
        .into_inner();
    assert!(
        matches!(exists.result, Some(write_file_response::Result::Failure(failure)) if failure.reason == FileFailureReason::AlreadyExists as i32)
    );

    std::fs::write(&file, "before\nold\nafter\n").unwrap();
    let replacement = client
        .replace_text(ReplaceTextRequest {
            request_id: "replace-once".into(),
            path: file.to_string_lossy().into_owned(),
            old_text: "old".into(),
            new_text: "new\nextra".into(),
        })
        .await
        .unwrap()
        .into_inner();
    let resent = client
        .replace_text(ReplaceTextRequest {
            request_id: "replace-once".into(),
            path: file.to_string_lossy().into_owned(),
            old_text: "old".into(),
            new_text: "new\nextra".into(),
        })
        .await
        .unwrap()
        .into_inner();
    assert_eq!(replacement, resent);
    assert!(
        matches!(replacement.result, Some(replace_text_response::Result::Replaced(result)) if result.start_line == 2 && result.line_count == 4)
    );
    let missing = client
        .replace_text(ReplaceTextRequest {
            request_id: "missing".into(),
            path: file.to_string_lossy().into_owned(),
            old_text: "absent".into(),
            new_text: "x".into(),
        })
        .await
        .unwrap()
        .into_inner();
    assert!(
        matches!(missing.result, Some(replace_text_response::Result::Failure(failure)) if failure.reason == FileFailureReason::TextNotFound as i32)
    );
    std::fs::write(&file, "aaaa").unwrap();
    let ambiguous = client
        .replace_text(ReplaceTextRequest {
            request_id: "ambiguous".into(),
            path: file.to_string_lossy().into_owned(),
            old_text: "aa".into(),
            new_text: "b".into(),
        })
        .await
        .unwrap()
        .into_inner();
    assert!(
        matches!(ambiguous.result, Some(replace_text_response::Result::Failure(failure)) if failure.reason == FileFailureReason::TextAmbiguous as i32 && matches!(failure.details, Some(file_failure::Details::AmbiguousText(ref ambiguity)) if ambiguity.count == 3 && ambiguity.occurrences.len() == 3 && ambiguity.occurrences[0].line >= 1 && !ambiguity.occurrences[0].excerpt.is_empty()))
    );
}

#[tokio::test]
async fn refuses_parent_traversal_and_links_outside_roots() {
    let machine = common::Machine::new();
    std::os::unix::fs::symlink("/etc/passwd", machine.root().join("outside-link")).unwrap();
    let (_child, channel) = machine.attach().await;
    let mut client = FileServiceClient::new(channel);
    let traversal = client
        .get_entry(GetEntryRequest {
            path: machine
                .root()
                .join("../escape")
                .to_string_lossy()
                .into_owned(),
        })
        .await
        .unwrap_err();
    assert_eq!(traversal.code(), Code::PermissionDenied);
    let link = client
        .get_entry(GetEntryRequest {
            path: machine
                .root()
                .join("outside-link")
                .to_string_lossy()
                .into_owned(),
        })
        .await
        .unwrap_err();
    assert_eq!(link.code(), Code::PermissionDenied);
}

use std::os::unix::fs::MetadataExt;
use std::os::unix::fs::PermissionsExt;
