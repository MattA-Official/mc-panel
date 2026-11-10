//! Switching Flytower to another installed release, and back again if it isn't healthy, like
//! `packages/agent/src/updater.ts`. Runs as its own transient systemd unit (started by
//! `update.install` and `update.rollback`), because it restarts the agent that started it.

use std::fs;
use std::os::unix::fs::{MetadataExt, PermissionsExt};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, SystemTime};

use crate::entry_points::{AGENT_UNIT, set_agent_exec_start};
use crate::exec::Exec;
use crate::time::iso;
use crate::verbs::{UpdateRecord, UpdateState};

const DB_FILES: [&str; 3] = ["flytower.db", "flytower.db-wal", "flytower.db-shm"];

/// What the panel's `/api/health` says, as far as the updater cares.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Health {
    pub version: String,
    pub agent_ok: bool,
}

/// Asks the panel on this port how it is.
pub type HealthCheck = Arc<dyn Fn(u16) -> Result<Health, String> + Send + Sync>;

pub struct Updater {
    /// Where releases live, with `current` pointing at one.
    pub prefix: PathBuf,
    /// The panel's data folder, holding its database.
    pub panel_data: PathBuf,
    pub config: PathBuf,
    pub systemd: PathBuf,
    pub state: PathBuf,
    pub exec: Arc<dyn Exec>,
    pub health: HealthCheck,
    pub sleep: Arc<dyn Fn(Duration) + Send + Sync>,
    pub now: Arc<dyn Fn() -> SystemTime + Send + Sync>,
    /// How long the new version has to become healthy.
    pub health_timeout: Duration,
}

/// The real health check: `curl` to the panel on this machine.
#[must_use]
pub fn curl_health(exec: Arc<dyn Exec>) -> HealthCheck {
    Arc::new(move |port| {
        let url = format!("http://127.0.0.1:{port}/api/health");
        let r = exec.run(
            "curl",
            &[
                "--fail",
                "--silent",
                "--show-error",
                "--max-time",
                "5",
                "--",
                &url,
            ],
        );
        if r.code != 0 {
            let why = r.stderr.trim();
            return Err(if why.is_empty() {
                "no answer".into()
            } else {
                why.into()
            });
        }
        let body: serde_json::Value =
            serde_json::from_str(&r.stdout).map_err(|_| "the answer wasn't JSON".to_string())?;
        Ok(Health {
            version: body["version"].as_str().unwrap_or_default().to_string(),
            agent_ok: body["agent"]["ok"].as_bool().unwrap_or(false),
        })
    })
}

/// Where the record of the last update lives.
#[must_use]
pub fn record_path(state: &Path) -> PathBuf {
    state.join("update.json")
}

/// The version `current` points at.
///
/// # Errors
/// If `current` isn't a symlink.
pub fn current_version(prefix: &Path) -> std::io::Result<String> {
    let target = fs::read_link(prefix.join("current"))?;
    Ok(target
        .to_string_lossy()
        .split('/')
        .rfind(|s| !s.is_empty())
        .unwrap_or_default()
        .to_string())
}

/// Replaces the first line starting with `start` (as the TypeScript `/^start.*$/m` does).
fn replace_line(text: &str, start: &str, line: &str) -> String {
    let mut done = false;
    text.split_inclusive('\n')
        .map(|l| {
            if !done && l.starts_with(start) {
                done = true;
                let end = &l[l.trim_end_matches(['\n', '\r']).len()..];
                format!("{line}{end}")
            } else {
                l.to_string()
            }
        })
        .collect()
}

fn rewrite(file: &Path, start: &str, line: &str) -> Result<(), String> {
    let text = fs::read_to_string(file).map_err(|e| format!("{}: {e}", file.display()))?;
    fs::write(file, replace_line(&text, start, line))
        .map_err(|e| format!("{}: {e}", file.display()))
}

/// A database file as it was before the update, and who owned it.
struct Saved {
    file: &'static str,
    uid: u32,
    gid: u32,
    mode: u32,
}

/// Copies a file, keeping its modified time, as `cp(…, { preserveTimestamps: true })` does.
fn copy(src: &Path, dest: &Path) -> std::io::Result<()> {
    fs::copy(src, dest)?;
    let modified = fs::metadata(src)?.modified()?;
    fs::File::options()
        .write(true)
        .open(dest)?
        .set_modified(modified)
}

impl Updater {
    fn run(&self, file: &str, args: &[&str]) -> Result<(), String> {
        let r = self.exec.run(file, args);
        if r.code == 0 {
            return Ok(());
        }
        let why = r.stderr.trim();
        Err(format!(
            "{file} {}: {}",
            args.join(" "),
            if why.is_empty() { "failed" } else { why }
        ))
    }

    fn release(&self, version: &str) -> PathBuf {
        self.prefix.join("releases").join(version)
    }

    fn point_at(&self, version: &str) -> Result<(), String> {
        let tmp = self.prefix.join("current.new");
        let _ = fs::remove_file(&tmp);
        std::os::unix::fs::symlink(self.release(version), &tmp)
            .and_then(|()| fs::rename(&tmp, self.prefix.join("current")))
            .map_err(|e| format!("can't point current at {version}: {e}"))
    }

    /// Rewrites the version lines the installer wrote, so health checks see the right one,
    /// and points the agent unit at the release's entry point.
    fn set_version(&self, version: &str) -> Result<(), String> {
        rewrite(
            &self.config.join("panel.env"),
            "NUXT_VERSION=",
            &format!("NUXT_VERSION={version}"),
        )?;
        rewrite(
            &self.systemd.join(AGENT_UNIT),
            "Environment=FLYTOWER_VERSION=",
            &format!("Environment=FLYTOWER_VERSION={version}"),
        )?;
        set_agent_exec_start(&self.systemd, &self.prefix, &self.release(version))
            .map(drop)
            .map_err(|e| e.message)
    }

    fn panel_port(&self) -> u16 {
        fs::read_to_string(self.config.join("panel.env"))
            .ok()
            .and_then(|env| {
                env.lines()
                    .find_map(|l| l.strip_prefix("PORT=")?.parse().ok())
            })
            .unwrap_or(3000)
    }

    fn switch_to(&self, version: &str) -> Result<(), String> {
        self.run("systemctl", &["stop", "flytower-panel.service"])?;
        self.point_at(version)?;
        self.set_version(version)?;
        self.run("systemctl", &["daemon-reload"])?;
        self.run("systemctl", &["restart", "flytower-agent.service"])?;
        self.run("systemctl", &["start", "flytower-panel.service"])
    }

    /// `None` once the panel reports `version` with the agent up; otherwise, after the
    /// timeout, why not.
    fn healthy(&self, version: &str) -> Option<String> {
        let port = self.panel_port();
        let deadline = (self.now)() + self.health_timeout;
        loop {
            let last = match (self.health)(port) {
                Ok(h) if h.version == version && h.agent_ok => return None,
                Ok(h) if h.version != version => format!("the panel reported {}", h.version),
                Ok(_) => "the system helper was down".to_string(),
                Err(e) => format!("the panel didn't answer ({e})"),
            };
            if (self.now)() >= deadline {
                return Some(last);
            }
            (self.sleep)(Duration::from_secs(2));
        }
    }

    fn write(&self, record: &UpdateRecord) -> UpdateRecord {
        if let Ok(json) = serde_json::to_string_pretty(record) {
            let _ = fs::write(record_path(&self.state), json);
        }
        record.clone()
    }

    /// Moves from the current release to `to`. The database is copied first (with the panel
    /// stopped, so the copy is consistent) and put back if the new version isn't healthy.
    #[must_use]
    pub fn run_update(&self, to: &str, manual: bool) -> UpdateRecord {
        let now = || iso((self.now)());
        let from = current_version(&self.prefix).unwrap_or_default();
        let record = self.write(&UpdateRecord {
            state: UpdateState::Running,
            from: from.clone(),
            to: to.into(),
            reason: None,
            at: now(),
            manual,
        });
        let finish = |state, reason: Option<String>| {
            self.write(&UpdateRecord {
                state,
                reason,
                at: now(),
                ..record.clone()
            })
        };
        if !self.release(to).join("VERSION").exists() {
            return self.write(&UpdateRecord {
                state: UpdateState::Failed,
                reason: Some(format!("release {to} isn't installed")),
                ..record.clone()
            });
        }

        let mut saved = Vec::new();
        let outcome = self
            .save_database(to, &mut saved)
            .and_then(|()| self.switch_to(to))
            .map(|()| self.healthy(to));
        match outcome {
            Ok(None) => {
                self.prune(&[to, &from]);
                finish(UpdateState::Succeeded, None)
            }
            Ok(Some(problem)) => {
                let _ = self.roll_back(&from, to, &saved);
                finish(UpdateState::RolledBack, Some(problem))
            }
            Err(e) => {
                let _ = self.roll_back(&from, to, &saved);
                finish(UpdateState::RolledBack, Some(e))
            }
        }
    }

    fn save_database(&self, to: &str, saved: &mut Vec<Saved>) -> Result<(), String> {
        self.run("systemctl", &["stop", "flytower-panel.service"])?;
        for file in DB_FILES {
            let src = self.panel_data.join(file);
            let Ok(meta) = fs::metadata(&src) else {
                continue;
            };
            copy(&src, &self.panel_data.join(format!("{file}.before-{to}")))
                .map_err(|e| format!("can't copy {}: {e}", src.display()))?;
            saved.push(Saved {
                file,
                uid: meta.uid(),
                gid: meta.gid(),
                mode: meta.mode(),
            });
        }
        Ok(())
    }

    fn roll_back(&self, from: &str, to: &str, saved: &[Saved]) -> Result<(), String> {
        let _ = self.run("systemctl", &["stop", "flytower-panel.service"]);
        for file in DB_FILES {
            let dest = self.panel_data.join(file);
            let _ = fs::remove_file(&dest);
            let Some(was) = saved.iter().find(|s| s.file == file) else {
                continue;
            };
            // The updater runs as root, so a restored file must go back to the panel's user,
            // or SQLite can't open it (a root-owned -shm file stops the panel starting).
            let back = self.panel_data.join(format!("{file}.before-{to}"));
            copy(&back, &dest)
                .and_then(|()| std::os::unix::fs::chown(&dest, Some(was.uid), Some(was.gid)))
                .and_then(|()| {
                    fs::set_permissions(&dest, fs::Permissions::from_mode(was.mode & 0o7777))
                })
                .map_err(|e| format!("can't restore {}: {e}", dest.display()))?;
        }
        self.switch_to(from)
    }

    /// Keeps only the releases named; runtimes and everything else stay.
    fn prune(&self, keep: &[&str]) {
        let Ok(entries) = fs::read_dir(self.prefix.join("releases")) else {
            return;
        };
        for entry in entries.flatten() {
            let name = entry.file_name();
            if !keep.iter().any(|k| name.to_str() == Some(k)) {
                let _ = crate::handlers::files::remove(&entry.path());
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use super::*;
    use crate::entry_points::tests::{machine, new_exec, old_exec, unit};
    use crate::handlers::testing::{Fake, TempRoot};

    fn updater(root: &TempRoot, fake: &Fake, health: HealthCheck) -> Updater {
        let p = &root.paths;
        Updater {
            prefix: p.prefix.clone().into(),
            panel_data: p.panel_data.clone().into(),
            config: p.config.clone().into(),
            systemd: p.systemd.clone().into(),
            state: p.state.clone().into(),
            exec: Arc::new(fake.clone()),
            health,
            sleep: Arc::new(|_| {}),
            now: Arc::new(SystemTime::now),
            health_timeout: Duration::ZERO,
        }
    }

    /// 0.4.0 running and 0.5.0 installed, with a panel env file and a database.
    fn layout() -> (TempRoot, PathBuf) {
        let root = TempRoot::new("updater");
        let prefix = machine(&root);
        let p = &root.paths;
        fs::write(
            Path::new(&p.config).join("panel.env"),
            "NUXT_VERSION=0.4.0\nPORT=3000\n",
        )
        .unwrap();
        fs::write(Path::new(&p.panel_data).join("flytower.db"), "old database").unwrap();
        (root, prefix)
    }

    fn healthy_as(version: &str) -> HealthCheck {
        let version = version.to_string();
        Arc::new(move |_| {
            Ok(Health {
                version: version.clone(),
                agent_ok: true,
            })
        })
    }

    fn read(path: impl AsRef<Path>) -> String {
        fs::read_to_string(path).unwrap()
    }

    #[test]
    fn switches_over_when_the_new_version_is_healthy() {
        let (root, prefix) = layout();
        let p = &root.paths;
        // An old release that is neither current nor the new one goes.
        fs::create_dir_all(prefix.join("releases/0.3.0")).unwrap();
        let fake = Fake::new(vec![]);
        let record = updater(&root, &fake, healthy_as("0.5.0")).run_update("0.5.0", false);
        assert_eq!(record.state, UpdateState::Succeeded);
        assert_eq!(
            (record.from.as_str(), record.to.as_str()),
            ("0.4.0", "0.5.0")
        );
        assert_eq!(current_version(&prefix).unwrap(), "0.5.0");
        assert!(read(Path::new(&p.config).join("panel.env")).contains("NUXT_VERSION=0.5.0\n"));
        let agent = read(Path::new(&p.systemd).join(AGENT_UNIT));
        assert!(agent.contains("FLYTOWER_VERSION=0.5.0"));
        assert!(agent.contains(&new_exec(&prefix)));
        let saved = Path::new(&p.panel_data).join("flytower.db.before-0.5.0");
        assert_eq!(read(saved), "old database");
        assert!(
            fake.ran()
                .contains(&"systemctl restart flytower-agent.service".to_string())
        );
        assert!(!prefix.join("releases/0.3.0").exists());
        let on_disk: UpdateRecord =
            serde_json::from_str(&read(record_path(Path::new(&p.state)))).unwrap();
        assert_eq!(on_disk, record);
    }

    #[test]
    fn rolls_back_database_included_when_the_new_version_never_comes_up() {
        let (root, prefix) = layout();
        let p = root.paths.clone();
        let fake = Fake::new(vec![]);
        let checks = Arc::new(Mutex::new(0));
        let db = Path::new(&p.panel_data).join("flytower.db");
        let health: HealthCheck = {
            let db = db.clone();
            Arc::new(move |_| {
                // The new panel "migrates" the database, then reports the wrong version.
                let mut n = checks.lock().unwrap();
                if *n == 0 {
                    fs::write(&db, "migrated").unwrap();
                }
                *n += 1;
                Ok(Health {
                    version: "0.4.0".into(),
                    agent_ok: true,
                })
            })
        };
        let record = updater(&root, &fake, health).run_update("0.5.0", false);
        assert_eq!(record.state, UpdateState::RolledBack);
        assert_eq!(record.reason.as_deref(), Some("the panel reported 0.4.0"));
        assert_eq!(current_version(&prefix).unwrap(), "0.4.0");
        assert!(read(Path::new(&p.config).join("panel.env")).contains("NUXT_VERSION=0.4.0"));
        assert_eq!(read(&db), "old database");
        // The agent unit went back to the old release's entry point too.
        assert_eq!(
            read(Path::new(&p.systemd).join(AGENT_UNIT)),
            unit(&old_exec(&prefix))
        );
        // Both releases are kept after a rollback.
        assert!(prefix.join("releases/0.5.0").exists());
    }

    #[test]
    fn rolls_back_when_a_step_fails_and_reports_why() {
        let (root, prefix) = layout();
        let fake = Fake::new(vec![(
            "systemctl daemon-reload",
            crate::exec::ExecResult {
                code: 1,
                stderr: "no bus".into(),
                ..Default::default()
            },
        )]);
        let record = updater(&root, &fake, healthy_as("0.5.0")).run_update("0.5.0", true);
        assert_eq!(record.state, UpdateState::RolledBack);
        assert_eq!(
            record.reason.as_deref(),
            Some("systemctl daemon-reload: no bus")
        );
        assert!(record.manual);
        assert_eq!(current_version(&prefix).unwrap(), "0.4.0");
    }

    #[test]
    fn refuses_a_release_that_isnt_installed() {
        let (root, _) = layout();
        let fake = Fake::new(vec![]);
        let record = updater(&root, &fake, healthy_as("0.9.0")).run_update("0.9.0", false);
        assert_eq!(record.state, UpdateState::Failed);
        assert!(fake.ran().is_empty());
    }

    #[test]
    fn says_why_the_panel_isnt_healthy() {
        let (root, _) = layout();
        let fake = Fake::new(vec![]);
        let down: HealthCheck = Arc::new(|_| {
            Ok(Health {
                version: "0.5.0".into(),
                agent_ok: false,
            })
        });
        let u = updater(&root, &fake, down);
        assert_eq!(
            u.healthy("0.5.0").as_deref(),
            Some("the system helper was down")
        );
        let silent: HealthCheck = Arc::new(|_| Err("refused".into()));
        let u = Updater {
            health: silent,
            ..u
        };
        assert_eq!(
            u.healthy("0.5.0").as_deref(),
            Some("the panel didn't answer (refused)")
        );
    }

    #[test]
    fn reads_the_health_endpoint_with_curl() {
        let fake = Fake::new(vec![(
            "curl --fail --silent --show-error --max-time 5 -- http://127.0.0.1:3000/api/health",
            crate::handlers::testing::out(r#"{"version":"0.5.0","agent":{"ok":true}}"#),
        )]);
        let check = curl_health(Arc::new(fake));
        assert_eq!(
            check(3000).unwrap(),
            Health {
                version: "0.5.0".into(),
                agent_ok: true
            }
        );
    }
}
