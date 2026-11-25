//! Idempotency cache for Machine mutations.
//!
//! A resend after a dropped connection returns the first result instead of a
//! second effect. The cache is in memory only: after a daemon restart the key is
//! unknown and the outcome is unknown.

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
        T: Send + Sync,
        F: FnOnce() -> Fut + Send,
        Fut: Future<Output = T> + Send,
    {
        if key.is_empty() {
            return work().await;
        }
        loop {
            if let Some(slot) = self.slot(key) {
                return slot.get_or_init(work).await.clone();
            }
            tokio::time::sleep(Duration::from_millis(1)).await;
        }
    }

    fn slot(&self, key: &str) -> Option<Slot<T>> {
        let now = Instant::now();
        let Ok(mut slots) = self.slots.lock() else {
            return Some(Arc::new(OnceCell::new()));
        };
        slots.retain(|_, (at, slot)| {
            Arc::strong_count(slot) > 1 || (slot.initialized() && now.duration_since(*at) < MAX_AGE)
        });
        if let Some((_, slot)) = slots.get(key) {
            return Some(Arc::clone(slot));
        }
        if slots.len() >= MAX_KEYS {
            let oldest = slots
                .iter()
                .filter(|(_, (_, slot))| Arc::strong_count(slot) == 1)
                .min_by_key(|(_, (at, _))| *at)
                .map(|(key, _)| key.clone());
            let oldest = oldest?;
            slots.remove(&oldest);
        }
        Some(Arc::clone(
            &slots
                .entry(key.to_owned())
                .or_insert_with(|| (now, Arc::new(OnceCell::new())))
                .1,
        ))
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

    #[tokio::test]
    async fn replays_existing_key_when_cache_is_full() {
        let cache = IdempotencyCache::<usize>::default();
        for index in 0..MAX_KEYS {
            assert_eq!(
                cache.run(&index.to_string(), || async { index }).await,
                index
            );
        }

        assert_eq!(cache.run("0", || async { MAX_KEYS }).await, 0);
    }

    #[test]
    fn bounds_uninitialized_slots_and_reclaims_abandoned_slots() {
        let cache = IdempotencyCache::<usize>::default();
        let mut held = Vec::new();
        for index in 0..MAX_KEYS {
            let slot = Arc::new(OnceCell::new());
            cache
                .slots
                .lock()
                .unwrap()
                .insert(index.to_string(), (Instant::now(), Arc::clone(&slot)));
            held.push(slot);
        }

        assert!(cache.slot("overflow").is_none());
        assert_eq!(cache.slots.lock().unwrap().len(), MAX_KEYS);

        drop(held.pop());
        assert!(cache.slot("overflow").is_some());
        assert_eq!(cache.slots.lock().unwrap().len(), MAX_KEYS);
    }
}
