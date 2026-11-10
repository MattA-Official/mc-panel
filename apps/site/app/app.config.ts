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
  /** Docs sidebar, in reading order. Paths match the files in the repo's docs/ folder. */
  docsNav: [
    {
      title: 'Getting started',
      pages: ['/docs/readme', '/docs/install', '/docs/first-server', '/docs/account'],
    },
    {
      title: 'Running servers',
      pages: [
        '/docs/content',
        '/docs/backups',
        '/docs/addresses',
        '/docs/crashes',
        '/docs/notifications',
      ],
    },
    { title: 'Looking after the machine', pages: ['/docs/updating', '/docs/troubleshooting'] },
    { title: 'Reference', pages: ['/docs/spec'] },
  ],
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
