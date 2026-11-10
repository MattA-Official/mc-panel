export default defineAppConfig({
  docs: {
    /** Where the docs live in this app: /help in the panel, /docs on the website. */
    base: '/docs',
  },
})

declare module '@nuxt/schema' {
  interface AppConfigInput {
    docs?: { base?: string }
  }
}
