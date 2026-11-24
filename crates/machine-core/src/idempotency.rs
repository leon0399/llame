//! Results of mutating calls by idempotency key, so a resend after a dropped
//! connection returns the first result instead of a second effect. In memory
//! only: after a daemon restart the key is unknown and the outcome is unknown.

use std::{
    collections::HashMap,
    future::Future,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use tokio::sync::OnceCell;

const MAX_KEYS: usize = 4096;
const MAX_AGE: Duration = Duration::from_secs(600);

type Slot<T> = Arc<OnceCell<T>>;

#[derive(Debug)]
pub struct IdempotencyCache<T> {
    slots: Mutex<HashMap<String, (Instant, Slot<T>)>>,
}

impl<T> Default for IdempotencyCache<T> {
    fn default() -> Self {
        Self {
            slots: Mutex::new(HashMap::new()),
        }
    }
}

impl<T: Clone> IdempotencyCache<T> {
    /// Runs `work` once per key; a concurrent or later call with the same key
    /// waits for and returns the first result. An empty key is never cached.
    pub async fn run<F, Fut>(&self, key: &str, work: F) -> T
    where
        F: FnOnce() -> Fut,
        Fut: Future<Output = T>,
    {
        if key.is_empty() {
            return work().await;
        }
        let slot = self.slot(key);
        slot.get_or_init(work).await.clone()
    }

    fn slot(&self, key: &str) -> Slot<T> {
        let now = Instant::now();
        let Ok(mut slots) = self.slots.lock() else {
            return Arc::new(OnceCell::new());
        };
        slots.retain(|_, (at, slot)| now.duration_since(*at) < MAX_AGE || !slot.initialized());
        if slots.len() >= MAX_KEYS
            && let Some(oldest) = slots
                .iter()
                .filter(|(_, (_, slot))| slot.initialized())
                .min_by_key(|(_, (at, _))| *at)
                .map(|(key, _)| key.clone())
        {
            slots.remove(&oldest);
        }
        Arc::clone(
            &slots
                .entry(key.to_owned())
                .or_insert_with(|| (now, Arc::new(OnceCell::new())))
                .1,
        )
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicU32, Ordering};

    use super::*;

    #[tokio::test]
    async fn runs_once_per_key() {
        let cache = IdempotencyCache::<u32>::default();
        let calls = AtomicU32::new(0);
        let run = || async { calls.fetch_add(1, Ordering::SeqCst) + 10 };
        assert_eq!(cache.run("k", run).await, 10);
        assert_eq!(cache.run("k", run).await, 10);
        assert_eq!(cache.run("", run).await, 11);
        assert_eq!(calls.load(Ordering::SeqCst), 2);
    }
}
