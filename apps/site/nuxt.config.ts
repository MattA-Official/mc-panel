// https://nuxt.com/docs/api/configuration/nuxt-config
// The Flytower website: landing page, docs (from the repo's docs/ folder), changelog and
// sponsor pages. Every page is prerendered at build time; the Cloudflare Worker serves them as
// static assets and is free to grow server routes later.
export default defineNuxtConfig({
  compatibilityDate: '2026-11-01',
  // The docs collection, link handling and section grouping are shared with the panel.
  extends: ['../../packages/docs-layer'],
  modules: ['@nuxt/ui', '@nuxt/content'],
  css: ['~/assets/css/main.css'],
  colorMode: { preference: 'dark', fallback: 'dark' },
  app: {
    head: {
      htmlAttrs: { lang: 'en-GB' },
      link: [{ rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }],
    },
  },
  // Fonts come from @fontsource imports in main.css, so the site never calls a font CDN.
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
  icon: { provider: 'none', clientBundle: { scan: true } },
  content: {
    build: {
      markdown: {
        highlight: {
          theme: { default: 'github-light', dark: 'github-dark' },
          langs: ['sh', 'bash', 'yaml', 'json', 'ts', 'ini'],
        },
      },
    },
    experimental: { sqliteConnector: 'native' },
    // Pages are prerendered, so visitors never query this. Declaring it stops a build warning; the
    // binding only needs to exist if a page is ever rendered at request time.
    database: { type: 'd1', bindingName: 'DB' },
  },
  runtimeConfig: {
    public: {
      /** Cloudflare Web Analytics token; empty means no beacon is added. */
      cfAnalyticsToken: '',
    },
  },
  nitro: {
    preset: 'cloudflare_module',
    prerender: { crawlLinks: true, routes: ['/', '/404.html'], failOnError: true },
  },
  routeRules: {
    '/**': {
      headers: {
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'strict-origin-when-cross-origin',
        'permissions-policy': 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
      },
    },
  },
  typescript: { strict: true },
})
