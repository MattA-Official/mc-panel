// Flytower website settings. The domain is a placeholder until it is registered: change `url`
// and `email` here and nowhere else.
export default defineAppConfig({
  site: {
    name: 'Flytower',
    url: 'https://flytower.example',
    email: { hello: 'hello@flytower.example', privacy: 'privacy@flytower.example' },
    tagline: 'Run Minecraft servers on your own VPS, from the browser.',
    repo: 'https://github.com/MattA-Official/mc-panel',
    releases: 'https://github.com/MattA-Official/mc-panel/releases',
    sponsors: 'https://github.com/sponsors/MattA-Official',
    kofi: '', // set once the Ko-fi page exists
    discord: '', // set once the Discord server exists
    install:
      'curl -fsSL https://github.com/MattA-Official/mc-panel/releases/latest/download/install.sh | sudo bash -s -- --domain panel.example.com',
  },
  /** Docs are served at /docs; the sidebar groups pages by their `section` frontmatter. */
  docs: { base: '/docs' },
  ui: {
    colors: {
      primary: 'tungsten',
      neutral: 'steel',
      success: 'emerald',
      warning: 'tungsten',
      error: 'red',
      info: 'blue',
    },
  },
})
