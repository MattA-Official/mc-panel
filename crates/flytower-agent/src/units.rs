//! systemd units and the files beside them, matching `packages/agent/src/units.ts` byte for
//! byte: both agents rewrite the template when it differs, so any drift would make them fight.
//! `protocol/fixtures/server-unit.service` pins the text; both test suites check it.

use std::path::Path;

/// Where the agent keeps things, from the same environment variables as the TypeScript agent.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Paths {
    pub servers: String,
    pub runtimes: String,
    pub archive: String,
    pub config: String,
    pub systemd: String,
    /// Root only.
    pub state: String,
    /// Where releases live, with `current` pointing at one.
    pub prefix: String,
    /// The panel's data folder, holding its database.
    pub panel_data: String,
    /// Where `/var/log`, `/var/cache/apt` and `/tmp` are found: `/` except in tests.
    pub system: String,
}

impl Paths {
    /// The defaults, each overridden by its `FLYTOWER_*` variable.
    #[must_use]
    pub fn from_env() -> Self {
        let env = |name: &str, fallback: &str| {
            std::env::var(name).unwrap_or_else(|_| fallback.to_string())
        };
        Self {
            servers: env("FLYTOWER_SERVERS_DIR", "/srv/flytower/servers"),
            runtimes: env("FLYTOWER_RUNTIMES_DIR", "/opt/flytower/runtimes"),
            archive: env("FLYTOWER_ARCHIVE_DIR", "/var/lib/flytower/archive"),
            config: env("FLYTOWER_CONFIG_DIR", "/etc/flytower"),
            systemd: env("FLYTOWER_SYSTEMD_DIR", "/etc/systemd/system"),
            state: env("FLYTOWER_AGENT_STATE_DIR", "/var/lib/flytower/agent"),
            prefix: env("FLYTOWER_PREFIX", "/opt/flytower"),
            panel_data: env("FLYTOWER_PANEL_DATA", "/var/lib/flytower"),
            system: "/".into(),
        }
    }

    /// Everything under one folder, for tests.
    #[must_use]
    pub fn under(root: &Path) -> Self {
        let at = |name: &str| root.join(name).to_string_lossy().into_owned();
        Self {
            servers: at("servers"),
            runtimes: at("runtimes"),
            archive: at("archive"),
            config: at("etc"),
            systemd: at("systemd"),
            state: at("state"),
            prefix: at("prefix"),
            panel_data: at("panel"),
            system: at("system"),
        }
    }
}

/// The one systemd template every server runs under. Per-server values come from the
/// environment file and a drop-in, never from string-building inside this template. `$$` is
/// systemd's escape for a literal `$`, so the shell (not systemd) expands the variables.
#[must_use]
pub fn template_unit(paths: &Paths, panel_group: &str) -> String {
    let servers = &paths.servers;
    let config = &paths.config;
    format!(
        r#"# Managed by Flytower. Changes are overwritten.
[Unit]
Description=Minecraft server %i (Flytower)
After=network-online.target
Wants=network-online.target
# Three failed starts in ten minutes is a crash loop: systemd leaves the server failed
# instead of restarting it forever. Starting it from the panel clears this.
StartLimitIntervalSec=600
StartLimitBurst=3

[Service]
User=mc-%i
Group={panel_group}
UMask=0007
WorkingDirectory={servers}/%i
EnvironmentFile={config}/servers/%i.env
ExecStart=/bin/sh -c 'exec "$$JAVA_HOME/bin/java" -Xms$${{HEAP_MB}}M -Xmx$${{HEAP_MB}}M $$JVM_FLAGS -jar server.jar nogui'
SuccessExitStatus=0 143
TimeoutStopSec=120
Restart=on-failure
RestartSec=15
# systemd 254+ waits longer after each crash, up to a minute; older versions ignore these.
RestartSteps=3
RestartMaxDelaySec=60
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
PrivateDevices=yes
ReadWritePaths={servers}/%i
Slice=flytower-mc.slice

[Install]
WantedBy=multi-user.target
"#
    )
}

/// Aikar's G1 flags.
pub const JVM_FLAGS: &str = "-XX:+UseG1GC -XX:+ParallelRefProcEnabled -XX:MaxGCPauseMillis=200 \
-XX:+UnlockExperimentalVMOptions -XX:+DisableExplicitGC -XX:+AlwaysPreTouch \
-XX:G1NewSizePercent=30 -XX:G1MaxNewSizePercent=40 -XX:G1HeapRegionSize=8M \
-XX:G1ReservePercent=20 -XX:InitiatingHeapOccupancyPercent=15 -XX:SurvivorRatio=32 \
-XX:+PerfDisableSharedMem -XX:MaxTenuringThreshold=1";

#[must_use]
pub fn env_file(java_home: &str, heap_mb: i64) -> String {
    format!(
        "# Managed by Flytower.\nJAVA_HOME={java_home}\nHEAP_MB={heap_mb}\nJVM_FLAGS={JVM_FLAGS}\n"
    )
}

/// Heap plus 1 GB for the JVM's own overhead, so a leak can't take the whole box down.
#[must_use]
pub fn limits_drop_in(heap_mb: i64) -> String {
    format!(
        "# Managed by Flytower.\n[Service]\nMemoryMax={}M\nMemorySwapMax=0\n",
        heap_mb + 1024
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(name: &str) -> String {
        let path = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../protocol/fixtures")
            .join(name);
        std::fs::read_to_string(path).unwrap()
    }

    #[test]
    fn template_matches_the_typescript_agent() {
        let paths = Paths {
            servers: "/srv/flytower/servers".into(),
            config: "/etc/flytower".into(),
            ..Paths::under(Path::new("/x"))
        };
        assert_eq!(
            template_unit(&paths, "flytower"),
            fixture("server-unit.service")
        );
    }

    #[test]
    fn env_and_limits_match_the_typescript_agent() {
        assert_eq!(
            env_file("/opt/flytower/runtimes/temurin-25", 6144),
            fixture("server.env")
        );
        assert_eq!(
            limits_drop_in(6144),
            "# Managed by Flytower.\n[Service]\nMemoryMax=7168M\nMemorySwapMax=0\n"
        );
    }
}
