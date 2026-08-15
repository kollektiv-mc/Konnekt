import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist', 'wailsjs'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      // Classic hooks rules only. The plugin's `recommended`/`recommended-latest`
      // configs also enable React Compiler-readiness diagnostics (purity,
      // refs-during-render, set-state-in-effect, etc.) that flag ~60 findings,
      // mostly in the react-three-fiber scene code (frontend/src/tiles/worlds/scene/)
      // where imperative ref sync each frame is the standard r3f pattern, not a bug.
      // Tracked as a follow-up in agent_docs/HEALTH_CHECKLIST.md rather than
      // enabled as errors here.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      // Codebase convention: prefix an intentionally-unused binding with `_`.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_' },
      ],
      // Static styling should go through Tailwind utilities backed by the CSS-
      // variable token system; genuinely dynamic values (computed transforms,
      // animation delays, RGL positions) are the sanctioned exception.
      'no-restricted-syntax': [
        'warn',
        {
          selector: "JSXAttribute[name.name='style']",
          message:
            'Prefer Tailwind utility classes over inline style={{}}. Inline styles are only for dynamic/computed values.',
        },
      ],
    },
  },
  // Milestone 2 ratchet: these directories have been migrated off inline
  // styles (agent_docs/HEALTH_CHECKLIST.md), so new ones there are a hard
  // error. Remaining justified exceptions (genuinely dynamic values) carry a
  // documented eslint-disable-next-line. Add more directories to this list
  // as each is cleared. Flat config applies later entries' matching rules on
  // top of earlier ones, so this must come after the global block.
  {
    files: [
      'src/components/ui/**/*.tsx',
      'src/components/*.tsx',
      'src/tiles/TileWrapper/**/*.tsx',
      'src/tiles/stats/**/*.tsx',
      'src/tiles/notifications/**/*.tsx',
      'src/tiles/quick-commands/**/*.tsx',
      'src/tiles/performance/**/*.tsx',
      'src/tiles/console/**/*.tsx',
      'src/tiles/mods/**/*.tsx',
      'src/tiles/backups/**/*.tsx',
      'src/tiles/scheduler/**/*.tsx',
      'src/tiles/config/**/*.tsx',
      'src/tiles/players/**/*.tsx',
    ],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "JSXAttribute[name.name='style']",
          message:
            'Prefer Tailwind utility classes over inline style={{}}. Inline styles are only for dynamic/computed values.',
        },
      ],
    },
  },
)
