//! Conversion helpers for protobuf time values.

use std::time::{SystemTime, UNIX_EPOCH};

use prost_types::Timestamp;

/// Convert a system time to the normalized protobuf timestamp representation.
pub fn timestamp(time: SystemTime) -> Timestamp {
    match time.duration_since(UNIX_EPOCH) {
        Ok(duration) => Timestamp {
            seconds: duration.as_secs().min(i64::MAX as u64) as i64,
            nanos: duration.subsec_nanos() as i32,
        },
        Err(error) => {
            let duration = error.duration();
            let seconds = duration.as_secs().min(i64::MAX as u64) as i64;
            if duration.subsec_nanos() == 0 {
                Timestamp { seconds: -seconds, nanos: 0 }
            } else {
                Timestamp { seconds: -seconds - 1, nanos: 1_000_000_000 - duration.subsec_nanos() as i32 }
            }
        }
    }
}
