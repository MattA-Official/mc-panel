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

/// Reads a time [`iso`] wrote (`YYYY-MM-DDTHH:MM:SS(.mmm)Z`). `None` for anything else.
#[must_use]
pub fn parse_iso(text: &str) -> Option<SystemTime> {
    let text = text.strip_suffix('Z')?;
    let (date, clock) = text.split_once('T')?;
    let num = |s: &str| {
        s.bytes()
            .all(|b| b.is_ascii_digit())
            .then(|| s.parse::<i64>().ok())
            .flatten()
    };
    let mut d = date.splitn(3, '-').map(num);
    let (year, month, day) = (d.next()??, d.next()??, d.next()??);
    let (hms, ms) = clock.split_once('.').unwrap_or((clock, "0"));
    let mut t = hms.splitn(3, ':').map(num);
    let (hour, min, sec) = (t.next()??, t.next()??, t.next()??);
    let ms = num(ms).filter(|_| ms.len() <= 3)? * 10_i64.pow(3 - u32::try_from(ms.len()).ok()?);
    if !(1..=12).contains(&month) || !(1..=31).contains(&day) || hour > 23 || min > 59 || sec > 60 {
        return None;
    }
    let total = ((days(year, month, day) * 24 + hour) * 60 + min) * 60 + sec;
    let millis = u64::try_from(total * 1000 + ms).ok()?;
    Some(UNIX_EPOCH + std::time::Duration::from_millis(millis))
}

/// A calendar date to days since 1970-01-01 (Howard Hinnant's `days_from_civil`).
const fn days(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y.rem_euclid(400);
    let mp = if m > 2 { m - 3 } else { m + 9 };
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
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

    #[test]
    fn reads_what_it_writes() {
        for ms in [0, 951_782_400_000, 1_794_323_045_123, 1_794_323_045_100] {
            let t = UNIX_EPOCH + Duration::from_millis(ms);
            assert_eq!(parse_iso(&iso(t)), Some(t));
        }
        assert_eq!(
            parse_iso("2026-11-09T13:00:00Z"),
            parse_iso("2026-11-09T13:00:00.000Z")
        );
        for bad in [
            "",
            "soon",
            "2026-11-09",
            "2026-13-01T00:00:00Z",
            "2026-11-09T13:00:00",
            "2026-11-09T13:00:00.1234Z",
        ] {
            assert_eq!(parse_iso(bad), None, "{bad}");
        }
    }
}
