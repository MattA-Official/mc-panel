// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2026-11-01',
  ssr: false,
  modules: ['@nuxt/ui', 'nuxt-auth-utils'],
  css: ['~/assets/css/main.css'],
  colorMode: { preference: 'dark', fallback: 'dark' },
  app: {
    head: {
      link: [{ rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }],
    },
  },
  // Fonts come from @fontsource imports in main.css; stop @nuxt/fonts fetching from the web.
  fonts: {
    providers: {
      google: false,
      googleicons: false,
      bunny: false,
      fontshare: false,
      fontsource: false,
      adobe: false,
    },
  },
  // Bundle the icons we use into the client; the panel never fetches icons at runtime.
  icon: { provider: 'none', clientBundle: { scan: true } },
  routeRules: {
    // The panel loads nothing from other sites except content icons (Modrinth, Hangar).
    '/**': {
      headers: {
        'content-security-policy': [
          "default-src 'self'",
          // Nuxt's SPA shell boots with a small inline script.
          "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",
          "style-src 'self' 'unsafe-inline'",
          "img-src 'self' data: blob: https:",
          "font-src 'self' data:",
          "connect-src 'self'",
          "worker-src 'self' blob:",
          "object-src 'none'",
          "base-uri 'self'",
          "form-action 'self'",
          "frame-ancestors 'none'",
        ].join('; '),
        'x-content-type-options': 'nosniff',
        'x-frame-options': 'DENY',
        'referrer-policy': 'same-origin',
        'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=()',
        'cross-origin-opener-policy': 'same-origin',
      },
    },
  },
  runtimeConfig: {
    version: '0.0.0-dev',
    agentSocket: '/run/flytower/agent.sock',
    dbPath: '/var/lib/flytower/flytower.db',
    /** Where the agent puts server folders; the panel reads logs from here. */
    serversDir: '/srv/flytower/servers',
    backupsDir: '/var/lib/flytower/backups',
    exportsDir: '/var/lib/flytower/exports',
    importsDir: '/var/lib/flytower/imports',
    /** Where the agent archives deleted servers. */
    archiveDir: '/var/lib/flytower/archive',
    /** Where the agent installs Java; the panel reads which versions are there. */
    runtimesDir: '/opt/flytower/runtimes',
    /** Modrinth's API; overridable for a mirror or for tests. */
    modrinthApi: 'https://api.modrinth.com/v2',
    hangarApi: 'https://hangar.papermc.io/api/v1',
    vanillaTweaksSite: 'https://vanillatweaks.net',
    setupTokenFile: '/var/lib/flytower/setup-token.hash',
    /** The machine's public addresses, if its interfaces don't show them (behind NAT). */
    machineIpv4: '',
    machineIpv6: '',
    devSetupToken: '',
    /** Pins the passkey domain; empty means the request's host. */
    rpId: '',
    session: {
      name: 'flytower-session',
      maxAge: 12 * 60 * 60,
      cookie: { sameSite: 'strict' },
    },
  },
  nitro: {
    preset: 'bun',
    experimental: { websocket: true },
  },
  $development: {
    runtimeConfig: {
      dbPath: '.data/flytower.db',
      serversDir: '.data/servers',
      backupsDir: '.data/backups',
      exportsDir: '.data/exports',
      importsDir: '.data/imports',
      archiveDir: '.data/archive',
      runtimesDir: '.data/runtimes',
      agentSocket: '.data/agent.sock',
      setupTokenFile: '.data/setup-token.hash',
      devSetupToken: 'dev-setup-token',
    },
  },
  typescript: { strict: true },
})
