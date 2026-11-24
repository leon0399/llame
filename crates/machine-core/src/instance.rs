//! The persistent instance id in `instance.json`: written once, published by a
//! hard link so racing daemons converge on one id.

use std::{
    fs, io,
    os::unix::fs::{OpenOptionsExt, PermissionsExt},
    path::{Path, PathBuf},
};

use serde::{Deserialize, Serialize};

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct InstanceDocument {
    instance_id: String,
}

pub fn instance_file(config_dir: &Path) -> PathBuf {
    config_dir.join("instance.json")
}

fn corrupt(file: &Path) -> io::Error {
    io::Error::other(format!(
        "The instance file {} is unreadable or corrupt; restore it or delete it to create a new instance id.",
        file.display()
    ))
}

fn is_instance_id(text: &str) -> bool {
    uuid::Uuid::parse_str(text).is_ok_and(|id| id.get_version_num() == 4 && id.hyphenated().to_string() == text)
}

fn read(file: &Path) -> io::Result<Option<String>> {
    let text = match fs::read_to_string(file) {
        Ok(text) => text,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err(corrupt(file)),
    };
    let document: InstanceDocument = serde_json::from_str(&text).map_err(|_| corrupt(file))?;
    if !is_instance_id(&document.instance_id) {
        return Err(corrupt(file));
    }
    Ok(Some(document.instance_id))
}

/// This Machine's id: the existing one, or a new one created now.
pub fn read_or_create(config_dir: &Path) -> io::Result<String> {
    let file = instance_file(config_dir);
    if let Some(id) = read(&file)? {
        return Ok(id);
    }
    fs::create_dir_all(config_dir)?;
    let _ = fs::set_permissions(config_dir, fs::Permissions::from_mode(0o700));
    let id = uuid::Uuid::new_v4().hyphenated().to_string();
    let temp = config_dir.join(format!("instance.json.{}.{}.tmp", std::process::id(), uuid::Uuid::new_v4()));
    let result = (|| {
        use std::io::Write;
        let mut out = fs::OpenOptions::new().write(true).create_new(true).mode(0o600).open(&temp)?;
        out.write_all(format!("{{\"instanceId\":\"{id}\"}}\n").as_bytes())?;
        out.sync_all()?;
        match fs::hard_link(&temp, &file) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => Ok(()),
            Err(error) => Err(error),
        }
    })();
    let _ = fs::remove_file(&temp);
    result?;
    read(&file)?.ok_or_else(|| corrupt(&file))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn creates_once_and_reads_back() {
        let dir = tempfile::tempdir().unwrap();
        let first = read_or_create(dir.path()).unwrap();
        assert!(is_instance_id(&first));
        assert_eq!(read_or_create(dir.path()).unwrap(), first);
    }

    #[test]
    fn reads_the_node_daemon_format() {
        let dir = tempfile::tempdir().unwrap();
        let id = "0b0f1c4e-2d4a-4c1b-9a7e-3f2d1c0b9a8e";
        fs::write(instance_file(dir.path()), format!("{{\"instanceId\":\"{id}\"}}\n")).unwrap();
        assert_eq!(read_or_create(dir.path()).unwrap(), id);
    }

    #[test]
    fn refuses_a_corrupt_file() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(instance_file(dir.path()), "nope").unwrap();
        assert!(read_or_create(dir.path()).is_err());
    }
}
