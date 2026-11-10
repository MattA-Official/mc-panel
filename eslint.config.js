import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import globals from 'globals'

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/.output/**', '**/.nuxt/**', '**/node_modules/**', '**/coverage/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { languageOptions: { globals: { ...globals.node } } },
  // The web map viewer runs in the browser on its own, without Nuxt.
  { files: ['apps/panel/public/_map/**'], languageOptions: { globals: { ...globals.browser } } },
)
