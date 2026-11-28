mod common;

use machine_protocol::v1::{
    EntryKind, FileFailureReason, GetEntryRequest, ListDirectoryRequest, ReadBytesRequest,
    ReadLinesRequest, ReplaceTextRequest, WriteFileRequest, WriteMode, file_failure,
    file_service_client::FileServiceClient, get_entry_response, list_directory_response,
    read_bytes_response, read_lines_response, replace_text_response, write_file_response,
};
use tonic::Code;

#[tokio::test]
#[expect(
    clippy::too_many_lines,
    reason = "Keep the RPC sequence and its assertions together"
)]
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
            limit: 1,
            max_bytes: 3,
        })
        .await
        .unwrap()
        .into_inner();
    let Some(read_lines_response::Result::Lines(exact_crlf)) = response.result else {
        panic!("exact-bound CRLF line read failed");
    };
    assert_eq!(exact_crlf.lines, ["one"]);
    assert!(!exact_crlf.truncated);
    let bare_cr = root.join("bare-cr.txt");
    std::fs::write(&bare_cr, b"a\r").unwrap();
    let response = client
        .read_lines(ReadLinesRequest {
            path: bare_cr.to_string_lossy().into_owned(),
            start_line: 1,
            limit: 0,
            max_bytes: 16,
        })
        .await
        .unwrap()
        .into_inner();
    let Some(read_lines_response::Result::Lines(bare_cr_lines)) = response.result else {
        panic!("unterminated CR line read failed");
    };
    assert_eq!(bare_cr_lines.lines, ["a\r"]);

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
    let empty_lines = root.join("empty-lines.txt");
    std::fs::write(&empty_lines, "\n".repeat(50_001)).unwrap();
    let response = client
        .read_lines(ReadLinesRequest {
            path: empty_lines.to_string_lossy().into_owned(),
            start_line: 1,
            limit: 0,
            max_bytes: 1,
        })
        .await
        .unwrap()
        .into_inner();
    let Some(read_lines_response::Result::Lines(empty_lines)) = response.result else {
        panic!("empty-line bounded read failed");
    };
    assert_eq!(empty_lines.lines.len(), 50_000);
    assert_eq!(empty_lines.line_count, 50_001);
    assert!(empty_lines.truncated);
    let window_file = root.join("window.txt");
    let mut content = "skip\n".repeat(50_000);
    content.push_str("target\n");
    std::fs::write(&window_file, content).unwrap();
    let response = client
        .read_lines(ReadLinesRequest {
            path: window_file.to_string_lossy().into_owned(),
            start_line: 50_001,
            limit: 1,
            max_bytes: 16,
        })
        .await
        .unwrap()
        .into_inner();
    let Some(read_lines_response::Result::Lines(window)) = response.result else {
        panic!("windowed lines read failed");
    };
    assert_eq!(window.lines, ["target"]);
    assert_eq!(window.line_count, 50_001);
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
            offset: 0,
            limit: 5,
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
        [
            "a.txt",
            "b.txt",
            "dangling-link",
            "inside-link",
            "outside-link"
        ]
    );
    assert_eq!(
        directory.entries[2].target_kind,
        Some(EntryKind::Unspecified as i32)
    );
    assert_eq!(
        directory.entries[3].target_kind,
        Some(EntryKind::File as i32)
    );
    assert_eq!(directory.entries[4].link_target, None);
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
async fn non_utf8_symlink_does_not_use_a_lossy_path_for_guarding() {
    use std::os::unix::{ffi::OsStrExt, fs::symlink};

    let machine = common::Machine::new();
    let root = machine.root();
    let collision = root.join("invalid-\u{fffd}");
    std::fs::write(root.join("inside-target"), "inside").unwrap();
    symlink(root.join("inside-target"), &collision).unwrap();
    let mut non_utf8_name = b"invalid-".to_vec();
    non_utf8_name.push(0xff);
    let non_utf8_link = root.join(std::ffi::OsStr::from_bytes(&non_utf8_name));
    symlink("/etc/passwd", non_utf8_link).unwrap();

    let (_child, channel) = machine.attach().await;
    let mut client = FileServiceClient::new(channel);
    let response = client
        .list_directory(ListDirectoryRequest {
            path: root.to_string_lossy().into_owned(),
            offset: 0,
            limit: 10,
        })
        .await
        .unwrap()
        .into_inner();
    let Some(list_directory_response::Result::Directory(directory)) = response.result else {
        panic!("listing failed");
    };
    let lossy_entries = directory
        .entries
        .iter()
        .filter(|entry| entry.name.starts_with("invalid-"))
        .collect::<Vec<_>>();
    assert_eq!(lossy_entries.len(), 2);
    assert!(
        lossy_entries
            .iter()
            .all(|entry| entry.kind == EntryKind::Symlink as i32)
    );
    assert!(
        lossy_entries
            .iter()
            .any(|entry| entry.link_target.is_none())
    );
    assert!(
        lossy_entries
            .iter()
            .all(|entry| entry.link_target.as_deref() != Some("/etc/passwd"))
    );
}

#[tokio::test]
#[expect(
    clippy::too_many_lines,
    reason = "Keep the RPC sequence and its assertions together"
)]
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
    assert_eq!(std::fs::read(&file).unwrap(), b"before\nold\nafter\n");
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
    assert_eq!(std::fs::read(&file).unwrap(), b"rewritten");
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
    assert_eq!(
        std::fs::read(&file).unwrap(),
        b"before\nnew\nextra\nafter\n"
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
        matches!(ambiguous.result, Some(replace_text_response::Result::Failure(failure)) if failure.reason == FileFailureReason::TextAmbiguous as i32 && failure.details.as_ref().is_some_and(|details| matches!(details, file_failure::Details::AmbiguousText(ambiguity) if ambiguity.count == 3 && ambiguity.occurrences.len() == 3 && ambiguity.occurrences.first().is_some_and(|occurrence| occurrence.line >= 1 && !occurrence.excerpt.is_empty()))))
    );
    std::fs::write(&file, "éé").unwrap();
    let unicode_ambiguous = client
        .replace_text(ReplaceTextRequest {
            request_id: "ambiguous-unicode".into(),
            path: file.to_string_lossy().into_owned(),
            old_text: "é".into(),
            new_text: "x".into(),
        })
        .await
        .unwrap()
        .into_inner();
    assert!(
        matches!(unicode_ambiguous.result, Some(replace_text_response::Result::Failure(failure)) if failure.reason == FileFailureReason::TextAmbiguous as i32 && failure.details.as_ref().is_some_and(|details| matches!(details, file_failure::Details::AmbiguousText(ambiguity) if ambiguity.count == 2 && ambiguity.occurrences.len() == 2)))
    );
    std::fs::write(&file, "aaaaaaaaaaaa").unwrap();
    let many_ambiguous = client
        .replace_text(ReplaceTextRequest {
            request_id: "ambiguous-many".into(),
            path: file.to_string_lossy().into_owned(),
            old_text: "a".into(),
            new_text: "x".into(),
        })
        .await
        .unwrap()
        .into_inner();
    assert!(matches!(
        many_ambiguous.result,
        Some(replace_text_response::Result::Failure(failure))
            if failure.details.as_ref().is_some_and(
                |details| matches!(
                    details,
                    file_failure::Details::AmbiguousText(ambiguity)
                        if ambiguity.count == 12 && ambiguity.occurrences.len() == 10
                )
            )
    ));
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

#[tokio::test]
async fn create_parents_reports_wrong_kind_for_a_file_component() {
    let machine = common::Machine::new();
    let root = machine.root();
    std::fs::write(root.join("not-a-directory"), "file").unwrap();
    let (_child, channel) = machine.attach().await;
    let mut client = FileServiceClient::new(channel);
    let response = client
        .write_file(WriteFileRequest {
            request_id: "wrong-parent-kind".into(),
            path: root
                .join("not-a-directory/child.txt")
                .to_string_lossy()
                .into_owned(),
            content: b"content".to_vec(),
            mode: WriteMode::Create as i32,
            create_parents: true,
        })
        .await
        .unwrap()
        .into_inner();
    assert!(matches!(
        response.result,
        Some(write_file_response::Result::Failure(failure))
            if failure.reason == FileFailureReason::WrongKind as i32
    ));
}

#[tokio::test]
async fn create_parents_reports_filesystem_errors_as_io_failures() {
    let machine = common::Machine::new();
    let root = machine.root();
    std::os::unix::fs::symlink(root.join("missing-target"), root.join("broken-parent")).unwrap();
    let (_child, channel) = machine.attach().await;
    let mut client = FileServiceClient::new(channel);
    let response = client
        .write_file(WriteFileRequest {
            request_id: "parent-create-io".into(),
            path: root
                .join("broken-parent/child.txt")
                .to_string_lossy()
                .into_owned(),
            content: b"content".to_vec(),
            mode: WriteMode::Create as i32,
            create_parents: true,
        })
        .await
        .unwrap()
        .into_inner();
    assert!(matches!(
        response.result,
        Some(write_file_response::Result::Failure(failure))
            if failure.reason == FileFailureReason::Io as i32
    ));
}

#[tokio::test]
async fn directory_listing_omits_ignore_ruled_entries_and_keeps_the_fixed_set() {
    let machine = common::Machine::new();
    let root = machine.root();
    let repo = root.join("repo");
    for dir in [".git", ".agents", "dist", "node_modules", "src"] {
        std::fs::create_dir_all(repo.join(dir)).unwrap();
    }
    std::fs::write(repo.join("dist/app.js"), "").unwrap();
    std::fs::write(repo.join("debug.log"), "").unwrap();
    std::fs::write(repo.join(".gitignore"), "dist/\nnode_modules/\n*.log\n").unwrap();
    std::fs::write(root.join(".ignore"), ".agents/\n").unwrap();
    let (_child, channel) = machine.attach().await;
    let mut client = FileServiceClient::new(channel);
    let mut list = async |path: &std::path::Path| {
        let response = client
            .list_directory(ListDirectoryRequest {
                path: path.to_string_lossy().into_owned(),
                offset: 0,
                limit: 0,
            })
            .await
            .unwrap()
            .into_inner();
        let Some(list_directory_response::Result::Directory(directory)) = response.result else {
            panic!("listing failed");
        };
        let names: Vec<String> = directory.entries.into_iter().map(|e| e.name).collect();
        (directory.total, names)
    };
    assert_eq!(
        list(&repo).await,
        (
            4,
            vec![
                ".git".into(),
                ".gitignore".into(),
                "node_modules".into(),
                "src".into()
            ]
        )
    );
    assert_eq!(list(&repo.join("dist")).await, (1, vec!["app.js".into()]));
}
