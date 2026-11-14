//! Subscriptions on one connection (protocol 2). Each connection has an [`Outbox`]: replies go
//! out in order, and each subscription has its own bounded queue of events, so a panel that
//! falls behind costs a count of what it missed (`{id, skipped}`), never more memory. One
//! writer thread per connection sends what's queued, and a `{ping}` when there's been nothing
//! for [`KEEPALIVE`] while subscriptions are live.

use std::collections::{BTreeMap, VecDeque};
use std::io::{self, Write};
use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use serde_json::Value;

use crate::envelope::{End, EndReason, Frame};

/// What a subscription does once it's been accepted: sends events through the sink until it
/// has nothing more to say or [`Sink::stopped`], then says why it ended.
pub type Stream = Box<dyn FnOnce(&Sink) -> End + Send>;

/// Most subscriptions one connection may hold at once.
pub const MAX_SUBSCRIPTIONS: usize = 64;

/// Most events queued for one subscription before newer ones are counted as skipped.
pub const QUEUE: usize = 1024;

/// How often a connection with live subscriptions hears something, if only a ping.
pub const KEEPALIVE: Duration = Duration::from_secs(30);

/// Most frames taken from one subscription per turn, so a busy one can't starve the rest.
const TURN: usize = 64;

struct Sub {
    queue: VecDeque<Frame>,
    skipped: u64,
    cancelled: bool,
    /// Its end frame is queued; the id is free again once that's written.
    ending: bool,
}

#[derive(Default)]
struct Inner {
    subs: BTreeMap<String, Sub>,
    replies: VecDeque<String>,
    closed: bool,
    /// The panel has stopped sending: write the replies still queued, then close.
    closing: bool,
    /// Where the round robin over subscriptions starts next.
    next: Option<String>,
}

/// What a connection has to send.
#[derive(Default)]
pub struct Outbox {
    inner: Mutex<Inner>,
    /// Something to write, or the connection closed.
    ready: Condvar,
    /// A subscription was cancelled, or the connection closed.
    stopped: Condvar,
    queue: usize,
}

fn lock(m: &Mutex<Inner>) -> MutexGuard<'_, Inner> {
    m.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
}

impl Outbox {
    #[must_use]
    pub fn new() -> Arc<Self> {
        Self::with_queue(QUEUE)
    }

    /// An outbox whose subscription queues hold `queue` events, so tests can fill one.
    #[must_use]
    pub fn with_queue(queue: usize) -> Arc<Self> {
        Arc::new(Self {
            queue,
            ..Self::default()
        })
    }

    /// Queues a reply line (an answer to a request or a subscribe).
    pub fn reply(&self, line: String) {
        let mut inner = lock(&self.inner);
        if inner.closed || inner.closing {
            return;
        }
        inner.replies.push_back(line);
        self.ready.notify_all();
    }

    /// Subscriptions that haven't ended.
    #[must_use]
    pub fn live(&self) -> usize {
        lock(&self.inner)
            .subs
            .values()
            .filter(|s| !s.ending)
            .count()
    }

    /// True if `id` names a subscription whose end hasn't been sent yet.
    #[must_use]
    pub fn has(&self, id: &str) -> bool {
        lock(&self.inner).subs.contains_key(id)
    }

    /// Opens a subscription and returns the handle its stream sends through.
    pub fn open(self: &Arc<Self>, id: &str, verb: &str) -> Sink {
        lock(&self.inner).subs.insert(
            id.to_string(),
            Sub {
                queue: VecDeque::new(),
                skipped: 0,
                cancelled: false,
                ending: false,
            },
        );
        Sink {
            id: id.to_string(),
            verb: verb.to_string(),
            out: Arc::clone(self),
        }
    }

    /// Stops a subscription: drops what's queued for it and tells its stream to stop. Ids
    /// that aren't live are ignored, since a cancel can cross an end on the wire.
    pub fn cancel(&self, id: &str) {
        let mut inner = lock(&self.inner);
        if let Some(sub) = inner.subs.get_mut(id).filter(|s| !s.ending) {
            sub.cancelled = true;
            sub.queue.clear();
            sub.skipped = 0;
            self.stopped.notify_all();
        }
    }

    /// Queues a subscription's end after whatever it sent, and returns it. A cancelled one
    /// always ends as cancelled, whatever its stream said.
    pub fn finish(&self, id: &str, end: End) -> End {
        let mut inner = lock(&self.inner);
        let Some(sub) = inner.subs.get_mut(id) else {
            return End::new(EndReason::Cancelled);
        };
        let end = if sub.cancelled {
            End::new(EndReason::Cancelled)
        } else {
            end
        };
        sub.ending = true;
        if sub.skipped > 0 {
            let skipped = std::mem::take(&mut sub.skipped);
            sub.queue.push_back(Frame::Skipped {
                id: id.to_string(),
                skipped,
            });
        }
        sub.queue.push_back(Frame::End {
            id: id.to_string(),
            end: end.clone(),
        });
        self.ready.notify_all();
        end
    }

    /// The panel has stopped sending (or must be dropped): every stream stops, and the writer
    /// ends once the replies already queued are written. Requests answered just before the
    /// panel half-closes its end still get their answer.
    pub fn close_gracefully(&self) {
        let mut inner = lock(&self.inner);
        inner.closing = true;
        inner.subs.clear();
        self.ready.notify_all();
        self.stopped.notify_all();
    }

    /// The connection is gone: every stream stops and the writer ends.
    pub fn close(&self) {
        let mut inner = lock(&self.inner);
        inner.closed = true;
        for sub in inner.subs.values_mut() {
            sub.cancelled = true;
        }
        self.ready.notify_all();
        self.stopped.notify_all();
    }

    #[must_use]
    pub fn is_closed(&self) -> bool {
        lock(&self.inner).closed
    }

    fn push_event(&self, id: &str, event: Value) -> bool {
        let mut inner = lock(&self.inner);
        if inner.closed || inner.closing {
            return false;
        }
        let Some(sub) = inner.subs.get_mut(id) else {
            return false;
        };
        if sub.cancelled || sub.ending {
            return false;
        }
        if sub.queue.len() >= self.queue {
            sub.skipped += 1;
            return true;
        }
        if sub.skipped > 0 {
            let skipped = std::mem::take(&mut sub.skipped);
            sub.queue.push_back(Frame::Skipped {
                id: id.to_string(),
                skipped,
            });
        }
        sub.queue.push_back(Frame::Event {
            id: id.to_string(),
            event,
        });
        self.ready.notify_all();
        true
    }

    fn stopped(&self, id: &str) -> bool {
        let inner = lock(&self.inner);
        inner.closed || inner.subs.get(id).is_none_or(|s| s.cancelled)
    }

    fn wait_stopped(&self, id: &str, timeout: Duration) -> bool {
        let deadline = Instant::now() + timeout;
        let mut inner = lock(&self.inner);
        loop {
            if inner.closed || inner.subs.get(id).is_none_or(|s| s.cancelled) {
                return true;
            }
            let left = deadline.saturating_duration_since(Instant::now());
            if left.is_zero() {
                return false;
            }
            inner = self
                .stopped
                .wait_timeout(inner, left)
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .0;
        }
    }

    /// Takes what's ready to write, in order: replies, then a turn of each subscription.
    /// Waits up to `keepalive` for something; with live subscriptions and nothing to send,
    /// that's a ping. `None` once the connection has closed.
    fn take(&self, keepalive: Duration) -> Option<String> {
        let deadline = Instant::now() + keepalive;
        let mut inner = lock(&self.inner);
        loop {
            if inner.closed {
                return None;
            }
            let batch = Self::batch(&mut inner);
            if !batch.is_empty() {
                return Some(batch);
            }
            if inner.closing {
                inner.closed = true;
                return None;
            }
            let left = deadline.saturating_duration_since(Instant::now());
            let live = inner.subs.values().any(|s| !s.ending);
            if left.is_zero() && live {
                return Some(Frame::Ping.encode());
            }
            let wait = if live { left } else { keepalive };
            inner = self
                .ready
                .wait_timeout(inner, wait)
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .0;
        }
    }

    fn batch(inner: &mut Inner) -> String {
        let mut out: String = inner.replies.drain(..).collect();
        // Round robin, starting after whichever subscription went first last time.
        let ids: Vec<String> = match &inner.next {
            Some(next) => inner
                .subs
                .range(next.clone()..)
                .chain(inner.subs.range(..next.clone()))
                .map(|(k, _)| k.clone())
                .collect(),
            None => inner.subs.keys().cloned().collect(),
        };
        let mut done = Vec::new();
        for id in &ids {
            let Some(sub) = inner.subs.get_mut(id) else {
                continue;
            };
            for _ in 0..TURN {
                let Some(frame) = sub.queue.pop_front() else {
                    break;
                };
                if matches!(frame, Frame::End { .. }) {
                    done.push(id.clone());
                }
                out.push_str(&frame.encode());
            }
            if sub.queue.is_empty() && sub.skipped > 0 && !sub.ending {
                let skipped = std::mem::take(&mut sub.skipped);
                out.push_str(
                    &Frame::Skipped {
                        id: id.clone(),
                        skipped,
                    }
                    .encode(),
                );
            }
        }
        for id in done {
            inner.subs.remove(&id);
        }
        // Next time, start with the one after the first.
        inner.next = ids.get(1).cloned();
        out
    }

    /// Writes what's queued to `w` until the connection closes or a write fails.
    ///
    /// # Errors
    /// The failed write; the connection is closed by then.
    pub fn write_all(&self, w: &mut impl Write) -> io::Result<()> {
        self.write_with_keepalive(w, KEEPALIVE)
    }

    /// [`write_all`](Self::write_all) with a chosen keepalive, for tests.
    ///
    /// # Errors
    /// The failed write; the connection is closed by then.
    pub fn write_with_keepalive(&self, w: &mut impl Write, keepalive: Duration) -> io::Result<()> {
        while let Some(batch) = self.take(keepalive) {
            if let Err(e) = w.write_all(batch.as_bytes()).and_then(|()| w.flush()) {
                self.close();
                return Err(e);
            }
        }
        Ok(())
    }
}

/// How a subscription's stream sends events. Cloning it is cheap, so a stream can hand it to
/// a shared follower that fans out to several subscribers.
#[derive(Clone)]
pub struct Sink {
    id: String,
    verb: String,
    out: Arc<Outbox>,
}

impl Sink {
    /// Queues an event. False once the subscription was cancelled or its connection closed:
    /// the stream should then return.
    ///
    /// # Panics
    /// In debug builds, if the event doesn't match the verb's schema: a bug in the stream.
    #[must_use]
    pub fn send(&self, event: Value) -> bool {
        #[cfg(debug_assertions)]
        if let Err(e) = crate::verbs::check_event(&self.verb, &event) {
            panic!("{} sent an invalid event {event}: {e}", self.verb);
        }
        self.out.push_event(&self.id, event)
    }

    /// True once the subscription was cancelled or its connection closed.
    #[must_use]
    pub fn stopped(&self) -> bool {
        self.out.stopped(&self.id)
    }

    /// Waits up to `timeout`, returning early (true) if the subscription stops.
    #[must_use]
    pub fn wait(&self, timeout: Duration) -> bool {
        self.out.wait_stopped(&self.id, timeout)
    }

    #[must_use]
    pub fn id(&self) -> &str {
        &self.id
    }

    #[must_use]
    pub fn verb(&self) -> &str {
        &self.verb
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn lines(text: &str) -> Vec<Value> {
        text.lines()
            .map(|l| serde_json::from_str(l).unwrap())
            .collect()
    }

    fn drain(out: &Outbox) -> Vec<Value> {
        let mut inner = lock(&out.inner);
        lines(&Outbox::batch(&mut inner))
    }

    #[test]
    fn sends_the_reply_before_events_and_the_end_after() {
        let out = Outbox::new();
        let sink = out.open("s", "testing.ticks");
        out.reply("{\"id\":\"s\",\"ok\":true,\"result\":{}}\n".into());
        assert!(sink.send(json!({ "n": 1 })));
        assert!(sink.send(json!({ "n": 2 })));
        let _ = out.finish("s", End::new(EndReason::Finished));
        assert!(out.has("s"));
        assert_eq!(out.live(), 0);
        let got = drain(&out);
        assert_eq!(
            got,
            [
                json!({ "id": "s", "ok": true, "result": {} }),
                json!({ "id": "s", "event": { "n": 1 } }),
                json!({ "id": "s", "event": { "n": 2 } }),
                json!({ "id": "s", "end": true, "reason": "finished" }),
            ]
        );
        assert!(!out.has("s"));
        // Sending after the end goes nowhere.
        assert!(!sink.send(json!({ "n": 3 })));
    }

    #[test]
    fn counts_what_a_slow_reader_missed() {
        let out = Outbox::with_queue(3);
        let sink = out.open("s", "testing.ticks");
        for n in 1..=10 {
            assert!(sink.send(json!({ "n": n })));
        }
        let got = drain(&out);
        assert_eq!(got.len(), 4);
        assert_eq!(got[3], json!({ "id": "s", "skipped": 7 }));
        // After catching up, events flow again.
        assert!(sink.send(json!({ "n": 11 })));
        assert_eq!(drain(&out), [json!({ "id": "s", "event": { "n": 11 } })]);
    }

    #[test]
    fn reports_skips_before_the_next_event_once_there_is_room() {
        let out = Outbox::with_queue(1);
        let sink = out.open("s", "testing.ticks");
        assert!(sink.send(json!({ "n": 1 })));
        assert!(sink.send(json!({ "n": 2 })));
        {
            let mut inner = lock(&out.inner);
            let first = inner.subs.get_mut("s").unwrap().queue.pop_front();
            assert!(matches!(first, Some(Frame::Event { .. })));
        }
        assert!(sink.send(json!({ "n": 3 })));
        assert_eq!(
            drain(&out),
            [
                json!({ "id": "s", "skipped": 1 }),
                json!({ "id": "s", "event": { "n": 3 } }),
            ]
        );
    }

    #[test]
    fn a_cancel_drops_the_queue_and_ends_as_cancelled() {
        let out = Outbox::new();
        let sink = out.open("s", "testing.ticks");
        assert!(sink.send(json!({ "n": 1 })));
        assert!(!sink.stopped());
        out.cancel("s");
        assert!(sink.stopped());
        assert!(sink.wait(Duration::from_secs(5)));
        assert!(!sink.send(json!({ "n": 2 })));
        assert_eq!(
            out.finish("s", End::new(EndReason::Finished)).reason,
            EndReason::Cancelled
        );
        assert_eq!(
            drain(&out),
            [json!({ "id": "s", "end": true, "reason": "cancelled" })]
        );
        // Unknown ids are ignored.
        out.cancel("nope");
    }

    #[test]
    fn takes_turns_between_busy_subscriptions() {
        let out = Outbox::new();
        let a = out.open("a", "testing.ticks");
        let b = out.open("b", "testing.ticks");
        for n in 1..=200 {
            assert!(a.send(json!({ "n": n })));
            assert!(b.send(json!({ "n": n })));
        }
        let first = drain(&out);
        let from = |id: &str| first.iter().filter(|f| f["id"] == id).count();
        assert_eq!((from("a"), from("b")), (TURN, TURN));
    }

    #[test]
    fn pings_while_subscriptions_are_live() {
        let out = Outbox::new();
        let _sink = out.open("s", "testing.ticks");
        assert_eq!(
            out.take(Duration::from_millis(20)).as_deref(),
            Some("{\"ping\":true}\n")
        );
        out.close();
        assert_eq!(out.take(Duration::from_millis(20)), None);
    }

    #[test]
    fn closing_gracefully_writes_the_replies_already_queued() {
        let out = Outbox::new();
        let sink = out.open("s", "testing.ticks");
        out.reply("{\"id\":\"1\",\"ok\":true,\"result\":{}}\n".into());
        out.close_gracefully();
        assert!(sink.stopped());
        let mut written = Vec::new();
        out.write_with_keepalive(&mut written, Duration::from_millis(10))
            .unwrap();
        assert_eq!(
            lines(&String::from_utf8(written).unwrap()),
            [json!({ "id": "1", "ok": true, "result": {} })]
        );
        assert!(out.is_closed());
    }

    #[test]
    fn closing_stops_every_stream() {
        let out = Outbox::new();
        let sink = out.open("s", "testing.ticks");
        let waiter = {
            let sink = sink.clone();
            std::thread::spawn(move || sink.wait(Duration::from_secs(10)))
        };
        out.close();
        assert!(waiter.join().unwrap());
        assert!(!sink.send(json!({ "n": 1 })));
    }
}
