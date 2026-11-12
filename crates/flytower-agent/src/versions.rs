//! Comparing release versions, exactly as `packages/protocol/src/versions.ts` does: the panel
//! offers only releases newer than the running one by this order, and the agent refuses to
//! install anything older.

use std::cmp::Ordering;

/// Compares x.y.z[-pre] versions. A pre-release sorts before its release, and pre-release
/// parts compare as semver does (beta.9 before beta.10).
#[must_use]
pub fn compare(a: &str, b: &str) -> Ordering {
    fn parse(v: &str) -> (Vec<f64>, Option<&str>) {
        let s = v.strip_prefix('v').unwrap_or(v);
        let (main, pre) = match s.split_once('-') {
            Some((m, p)) => (m, Some(p)),
            None => (s, None),
        };
        // As JavaScript's Number(): anything that isn't a number compares as NaN does.
        let nums = main
            .split('.')
            .map(|n| n.parse::<f64>().unwrap_or(f64::NAN))
            .collect();
        (nums, pre)
    }
    let (xn, xp) = parse(a);
    let (yn, yp) = parse(b);
    for i in 0..3 {
        let d = xn.get(i).copied().unwrap_or(0.0) - yn.get(i).copied().unwrap_or(0.0);
        // NaN is falsy in the TypeScript, so it moves on to the next part, as here.
        if d > 0.0 {
            return Ordering::Greater;
        }
        if d < 0.0 {
            return Ordering::Less;
        }
    }
    let (xp, yp) = match (xp, yp) {
        _ if xp == yp => return Ordering::Equal,
        (None, _) => return Ordering::Greater,
        (_, None) => return Ordering::Less,
        (Some(x), Some(y)) => (x, y),
    };
    let xs: Vec<&str> = xp.split('.').collect();
    let ys: Vec<&str> = yp.split('.').collect();
    let numeric = |s: &str| !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit());
    for i in 0..xs.len().max(ys.len()) {
        let (Some(p), Some(q)) = (xs.get(i), ys.get(i)) else {
            return if xs.len() < ys.len() {
                Ordering::Less
            } else {
                Ordering::Greater
            };
        };
        if p == q {
            continue;
        }
        return match (numeric(p), numeric(q)) {
            (true, true) => {
                let (pn, qn) = (
                    p.parse::<f64>().unwrap_or(0.0),
                    q.parse::<f64>().unwrap_or(0.0),
                );
                pn.partial_cmp(&qn).unwrap_or(Ordering::Equal)
            }
            (true, false) => Ordering::Less,
            (false, true) => Ordering::Greater,
            (false, false) => p.cmp(q),
        };
    }
    Ordering::Equal
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn orders_releases_pre_releases_and_native_builds() {
        let newest_first = [
            "1.5.0",
            "1.5.0-beta.10",
            "1.5.0-beta.9",
            "1.4.1",
            "1.4.0",
            "1.4.0-native.1",
            "1.4.0-beta.2.native.1",
            "1.4.0-beta.2",
            "0.9.0",
        ];
        for (i, a) in newest_first.iter().enumerate() {
            for (j, b) in newest_first.iter().enumerate() {
                assert_eq!(compare(a, b), j.cmp(&i), "{a} vs {b}");
            }
        }
        assert_eq!(compare("v1.2.3", "1.2.3"), Ordering::Equal);
    }
}
