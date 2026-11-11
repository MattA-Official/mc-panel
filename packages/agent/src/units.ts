import { dirname, isAbsolute, join, relative } from 'node:path'
import type { AgentContext } from './context.ts'

/**
 * Paths a server must never see: the agent's socket, the panel's data, the agent's state, the
 * archive of deleted servers and the panel's secrets. A path inside another listed one is
 * dropped, since hiding the parent already hides it. The leading `-` tells systemd to skip a
 * path that doesn't exist.
 */
export function hiddenPaths(ctx: AgentContext): string[] {
  const p = ctx.paths
  const all = [
    ...new Set([
      dirname(p.socket ?? '/run/flytower/agent.sock'),
      p.panelData ?? '/var/lib/flytower',
      p.state,
      p.archive,
      join(p.config, 'panel.env'),
    ]),
  ]
  const within = (child: string, parent: string) => {
    const r = relative(parent, child)
    return r !== '' && r !== '..' && !r.startsWith('../') && !isAbsolute(r)
  }
  return all.filter((path) => !all.some((other) => within(path, other)))
}

/**
 * The one systemd template every server runs under. Rewritten on each server.create, and
 * when the agent starts (see refreshTemplate), so a panel update can change it. Per-server values come from the environment file and a
 * drop-in, never from string-building inside this template. `$$` is systemd's escape for a
 * literal `$`, so the shell (not systemd) expands the variables.
 */
export const templateUnit = (ctx: AgentContext) => `# Managed by Flytower. Changes are overwritten.
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
Group=mc-%i
# The panel's group as an extra, so the server can use the files the panel puts in its folder.
SupplementaryGroups=${ctx.panelGroup}
UMask=0007
WorkingDirectory=${ctx.paths.servers}/%i
EnvironmentFile=${ctx.paths.config}/servers/%i.env
ExecStart=/bin/sh -c 'exec "$$JAVA_HOME/bin/java" -Xms$$\{HEAP_MB}M -Xmx$$\{HEAP_MB}M $$JVM_FLAGS -jar server.jar nogui'
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
ReadWritePaths=${ctx.paths.servers}/%i
# Mods run with the server's rights, so keep the root agent and the panel's secrets out of reach.
InaccessiblePaths=${hiddenPaths(ctx)
  .map((path) => `-${path}`)
  .join(' ')}
Slice=flytower-mc.slice

[Install]
WantedBy=multi-user.target
`

/** Aikar's G1 flags, the same set setup.sh used on nnt-minecraft-2. */
export const JVM_FLAGS = [
  '-XX:+UseG1GC',
  '-XX:+ParallelRefProcEnabled',
  '-XX:MaxGCPauseMillis=200',
  '-XX:+UnlockExperimentalVMOptions',
  '-XX:+DisableExplicitGC',
  '-XX:+AlwaysPreTouch',
  '-XX:G1NewSizePercent=30',
  '-XX:G1MaxNewSizePercent=40',
  '-XX:G1HeapRegionSize=8M',
  '-XX:G1ReservePercent=20',
  '-XX:InitiatingHeapOccupancyPercent=15',
  '-XX:SurvivorRatio=32',
  '-XX:+PerfDisableSharedMem',
  '-XX:MaxTenuringThreshold=1',
].join(' ')

export const envFile = (javaHome: string, heapMb: number) =>
  `# Managed by Flytower.\nJAVA_HOME=${javaHome}\nHEAP_MB=${heapMb}\nJVM_FLAGS=${JVM_FLAGS}\n`

/** Heap plus 1 GB for the JVM's own overhead, so a leak cannot take the whole box down. */
export const limitsDropIn = (heapMb: number) =>
  `# Managed by Flytower.\n[Service]\nMemoryMax=${heapMb + 1024}M\nMemorySwapMax=0\n`
