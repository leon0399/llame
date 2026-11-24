//! What this Machine is: OS, architecture, kernel, CPUs, memory, boot id.

use std::fs;

use machine_protocol::bootstrap::v1::Facts;

pub fn facts() -> Facts {
    let uname = rustix::system::uname();
    let cpu_count = std::thread::available_parallelism().map_or(1, |count| count.get() as u32);
    Facts {
        os: std::env::consts::OS.to_owned(),
        arch: std::env::consts::ARCH.to_owned(),
        kernel: uname.release().to_string_lossy().into_owned(),
        cpu_count,
        total_memory_bytes: total_memory_bytes(),
    }
}

fn total_memory_bytes() -> u64 {
    let Ok(text) = fs::read_to_string("/proc/meminfo") else { return 0 };
    text.lines()
        .find_map(|line| line.strip_prefix("MemTotal:"))
        .and_then(|rest| rest.trim().trim_end_matches("kB").trim().parse::<u64>().ok())
        .map_or(0, |kib| kib * 1024)
}

/// The kernel boot id; empty when the kernel does not report one.
pub fn boot_id() -> String {
    fs::read_to_string("/proc/sys/kernel/random/boot_id").map(|id| id.trim().to_owned()).unwrap_or_default()
}

/// Total bytes of the filesystem holding `path`.
pub fn disk_total_bytes(path: &str) -> Option<u64> {
    let stat = rustix::fs::statvfs(path).ok()?;
    stat.f_blocks.checked_mul(stat.f_frsize)
}
