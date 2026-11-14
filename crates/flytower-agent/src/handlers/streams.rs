//! What each subscription sends (protocol 2). Each stream runs on a thread of its own and
//! returns once it has nothing more to say or its sink has stopped.

use std::time::Duration;

use serde_json::json;

use crate::envelope::{End, EndReason};
use crate::stream::Stream;

/// `testing.ticks`: counts from 1 to `count`, waiting `interval` between events. Test builds
/// use it to check subscriptions end to end.
#[must_use]
pub fn ticks(count: u64, interval: Duration) -> Stream {
    Box::new(move |sink| {
        for n in 1..=count {
            if !sink.send(json!({ "n": n })) {
                return End::new(EndReason::Cancelled);
            }
            if !interval.is_zero() && n < count && sink.wait(interval) {
                return End::new(EndReason::Cancelled);
            }
        }
        End::new(EndReason::Finished)
    })
}
