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
  runtimeConfig: {
    version: '0.0.0-dev',
    agentSocket: '/run/flytower/agent.sock',
    dbPath: '/var/lib/flytower/flytower.db',
    /** Where the agent puts server folders; the panel reads logs from here. */
    serversDir: '/srv/flytower/servers',
    backupsDir: '/var/lib/flytower/backups',
    setupTokenFile: '/var/lib/flytower/setup-token.hash',
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
      agentSocket: '.data/agent.sock',
      setupTokenFile: '.data/setup-token.hash',
      devSetupToken: 'dev-setup-token',
    },
  },
  typescript: { strict: true },
})
