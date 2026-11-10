//! ISO 8601 times without a date crate: the audit log is the only user.

use std::time::{SystemTime, UNIX_EPOCH};

/// `time` as `2026-11-10T15:04:05.123Z`, like JavaScript's `toISOString`.
#[must_use]
pub fn iso(time: SystemTime) -> String {
    let since = time.duration_since(UNIX_EPOCH).unwrap_or_default();
    let secs = since.as_secs();
    let (y, m, d) = civil(i64::try_from(secs / 86_400).unwrap_or(0));
    let rem = secs % 86_400;
    format!(
        "{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}.{:03}Z",
        rem / 3600,
        rem / 60 % 60,
        rem % 60,
        since.subsec_millis()
    )
}

/// Days since 1970-01-01 to a calendar date (Howard Hinnant's `civil_from_days`).
fn civil(days: i64) -> (i64, i64, i64) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + i64::from(m <= 2);
    (y, m, d)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn formats_like_javascript() {
        assert_eq!(iso(UNIX_EPOCH), "1970-01-01T00:00:00.000Z");
        // new Date(1794323045123).toISOString()
        let t = UNIX_EPOCH + Duration::from_millis(1_794_323_045_123);
        assert_eq!(iso(t), "2026-11-10T15:04:05.123Z");
        // A leap day.
        let t = UNIX_EPOCH + Duration::from_hours(264_384);
        assert_eq!(iso(t), "2000-02-29T00:00:00.000Z");
    }
}
