//! Idempotency cache for Machine mutations.
//!
//! A resend after a dropped connection returns the first result instead of a
//! second effect. The cache is in memory only: after a daemon restart the key is
//! unknown and the outcome is unknown.

use std::{
    collections::HashMap,
    future::Future,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    time::{Duration, Instant},
};

use tokio::sync::{Notify, OnceCell};

const MAX_KEYS: usize = 4096;
const MAX_AGE: Duration = Duration::from_secs(600);

#[derive(Debug)]
struct Slot<T> {
    result: OnceCell<T>,
    started: AtomicBool,
    ready: Notify,
}

type CacheSlots<T> = HashMap<String, (Instant, Arc<Slot<T>>)>;

#[derive(Debug)]
pub struct IdempotencyCache<T> {
    slots: Mutex<CacheSlots<T>>,
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
        T: Send + Sync + 'static,
        F: FnOnce() -> Fut + Send + 'static,
        Fut: Future<Output = T> + Send + 'static,
    {
        if key.is_empty() {
            return work().await;
        }
        loop {
            if let Some(slot) = self.slot(key) {
                if !slot.started.swap(true, Ordering::AcqRel) {
                    let work_slot = Arc::clone(&slot);
                    drop(tokio::spawn(async move {
                        work_slot.result.get_or_init(work).await;
                        work_slot.ready.notify_waiters();
                    }));
                }
                loop {
                    let notified = slot.ready.notified();
                    tokio::pin!(notified);
                    notified.as_mut().enable();
                    if let Some(result) = slot.result.get() {
                        return result.clone();
                    }
                    notified.await;
                }
            }
            tokio::time::sleep(Duration::from_millis(1)).await;
        }
    }

    fn slot(&self, key: &str) -> Option<Arc<Slot<T>>> {
        let now = Instant::now();
        let Ok(mut slots) = self.slots.lock() else {
            return Some(Arc::new(Slot {
                result: OnceCell::new(),
                started: AtomicBool::new(false),
                ready: Notify::new(),
            }));
        };
        slots.retain(|_, (at, slot)| {
            Arc::strong_count(slot) > 1
                || (slot.result.initialized() && now.duration_since(*at) < MAX_AGE)
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
                .or_insert_with(|| {
                    (
                        now,
                        Arc::new(Slot {
                            result: OnceCell::new(),
                            started: AtomicBool::new(false),
                            ready: Notify::new(),
                        }),
                    )
                })
                .1,
        ))
    }
}

#[cfg(test)]
mod tests {
    use std::sync::{
        Arc,
        atomic::{AtomicU32, Ordering},
    };

    use super::*;

    #[tokio::test]
    async fn runs_once_per_key() {
        let cache = IdempotencyCache::<u32>::default();
        let calls = Arc::new(AtomicU32::new(0));
        let first_calls = Arc::clone(&calls);
        assert_eq!(
            cache
                .run("k", move || async move {
                    first_calls.fetch_add(1, Ordering::SeqCst) + 10
                })
                .await,
            10
        );
        let replay_calls = Arc::clone(&calls);
        assert_eq!(
            cache
                .run("k", move || async move {
                    replay_calls.fetch_add(1, Ordering::SeqCst) + 10
                })
                .await,
            10
        );
        let uncached_calls = Arc::clone(&calls);
        assert_eq!(
            cache
                .run("", move || async move {
                    uncached_calls.fetch_add(1, Ordering::SeqCst) + 10
                })
                .await,
            11
        );
        assert_eq!(calls.load(Ordering::SeqCst), 2);
    }

    #[tokio::test]
    async fn replays_existing_key_when_cache_is_full() {
        let cache = IdempotencyCache::<usize>::default();
        for index in 0..MAX_KEYS {
            assert_eq!(
                cache
                    .run(&index.to_string(), move || async move { index })
                    .await,
                index
            );
        }

        assert_eq!(cache.run("0", || async { MAX_KEYS }).await, 0);
    }

    #[tokio::test]
    async fn cancelled_caller_does_not_cancel_work_for_resend() {
        let cache = Arc::new(IdempotencyCache::<usize>::default());
        let calls = Arc::new(AtomicU32::new(0));
        let (started_tx, started_rx) = tokio::sync::oneshot::channel();
        let (release_tx, release_rx) = tokio::sync::oneshot::channel();

        let first_cache = Arc::clone(&cache);
        let first_calls = Arc::clone(&calls);
        let first = tokio::spawn(async move {
            first_cache
                .run("same-key", move || async move {
                    first_calls.fetch_add(1, Ordering::SeqCst);
                    started_tx.send(()).unwrap();
                    release_rx.await.unwrap();
                    42
                })
                .await
        });
        started_rx.await.unwrap();
        first.abort();

        let resend_cache = Arc::clone(&cache);
        let resend_calls = Arc::clone(&calls);
        let resend = tokio::spawn(async move {
            resend_cache
                .run("same-key", move || async move {
                    resend_calls.fetch_add(1, Ordering::SeqCst);
                    99
                })
                .await
        });
        release_tx.send(()).unwrap();

        assert_eq!(resend.await.unwrap(), 42);
        assert_eq!(calls.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn bounds_uninitialized_slots_and_reclaims_abandoned_slots() {
        let cache = IdempotencyCache::<usize>::default();
        let mut held = Vec::new();
        for index in 0..MAX_KEYS {
            let slot = Arc::new(Slot {
                result: OnceCell::new(),
                started: AtomicBool::new(false),
                ready: Notify::new(),
            });
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
