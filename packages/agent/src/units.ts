import type { AgentContext } from './context.ts'

/**
 * The one systemd template every server runs under. Rewritten on each server.create so a
 * panel update can change it. Per-server values come from the environment file and a
 * drop-in, never from string-building inside this template. `$$` is systemd's escape for a
 * literal `$`, so the shell (not systemd) expands the variables.
 */
export const templateUnit = (ctx: AgentContext) => `# Managed by Flytower. Changes are overwritten.
[Unit]
Description=Minecraft server %i (Flytower)
After=network-online.target
Wants=network-online.target

[Service]
User=mc-%i
Group=${ctx.panelGroup}
UMask=0007
WorkingDirectory=${ctx.paths.servers}/%i
EnvironmentFile=${ctx.paths.config}/servers/%i.env
ExecStart=/bin/sh -c 'exec "$$JAVA_HOME/bin/java" -Xms$$\{HEAP_MB}M -Xmx$$\{HEAP_MB}M $$JVM_FLAGS -jar server.jar nogui'
SuccessExitStatus=0 143
TimeoutStopSec=120
Restart=on-failure
RestartSec=15
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
PrivateDevices=yes
ReadWritePaths=${ctx.paths.servers}/%i
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
