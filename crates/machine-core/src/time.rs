//! Conversion helpers for protobuf time values.

use std::time::{SystemTime, UNIX_EPOCH};

use prost_types::Timestamp;

/// Convert a system time to the normalized protobuf timestamp representation.
pub fn timestamp(time: SystemTime) -> Timestamp {
    match time.duration_since(UNIX_EPOCH) {
        Ok(duration) => Timestamp {
            seconds: i64::try_from(duration.as_secs()).unwrap_or(i64::MAX),
            nanos: i32::try_from(duration.subsec_nanos()).unwrap_or_default(),
        },
        Err(error) => {
            let duration = error.duration();
            let seconds = i64::try_from(duration.as_secs()).unwrap_or(i64::MAX);
            if duration.subsec_nanos() == 0 {
                Timestamp { seconds: seconds.saturating_neg(), nanos: 0 }
            } else {
                Timestamp {
                    seconds: seconds.saturating_neg().saturating_sub(1),
                    nanos: 1_000_000_000 - i32::try_from(duration.subsec_nanos()).unwrap_or_default(),
                }
            }
        }
    }
}
