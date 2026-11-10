// Flytower: Nuxt UI v4 colour aliases. Scales are defined in assets/css/main.css.
export default defineAppConfig({
  /** The one place the product name lives, so a rename touches one line. */
  productName: 'Flytower',
  /** Help lives at /help (the website shows the same docs at /docs). */
  docs: { base: '/help' },
  ui: {
    colors: {
      primary: 'tungsten',
      neutral: 'steel',
      success: 'emerald', // running; exact shades come from --ft-running in custom status chips
      warning: 'tungsten', // starting / busy
      error: 'red', // crashed, destructive
      info: 'blue',
    },
  },
})
