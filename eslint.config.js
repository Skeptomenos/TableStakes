import eslint from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'test-results/**',
      'playwright-report/**',
      // Agent dogfood scratch (gitignored; ESLint does not read .gitignore).
      '.dogfood-bots.mjs',
    ],
  },
  eslint.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ['scripts/**/*.mjs', 'eslint.config.js'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        fetch: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        URL: 'readonly',
      },
    },
  },
  {
    // Secure-context-only browser APIs are absent on plain-HTTP LAN origins,
    // which is how every real player device reaches this app (see
    // ARCHITECTURE.md Client Architecture). Route ID generation through
    // src/client/uuid.ts; any other secure-context-only API needs an
    // explicit insecure-context fallback and a justified eslint-disable.
    files: ['src/client/**/*.{ts,tsx}'],
    ignores: ['src/client/uuid.ts'],
    rules: {
      'no-restricted-properties': [
        'error',
        {
          object: 'crypto',
          property: 'randomUUID',
          message:
            'Secure-context-only — absent on plain-HTTP LAN origins (every phone). Use uuid() from src/client/uuid.ts.',
        },
        {
          object: 'navigator',
          property: 'clipboard',
          message:
            'Secure-context-only — absent on plain-HTTP LAN origins (every phone). Requires an explicit insecure-context fallback and a justified eslint-disable.',
        },
        {
          object: 'navigator',
          property: 'share',
          message:
            'Secure-context-only — absent on plain-HTTP LAN origins (every phone). Requires an explicit insecure-context fallback and a justified eslint-disable.',
        },
        {
          object: 'navigator',
          property: 'wakeLock',
          message:
            'Secure-context-only — absent on plain-HTTP LAN origins (every phone). Requires an explicit insecure-context fallback and a justified eslint-disable.',
        },
        {
          object: 'navigator',
          property: 'serviceWorker',
          message:
            'Secure-context-only — absent on plain-HTTP LAN origins (every phone). Requires an explicit insecure-context fallback and a justified eslint-disable.',
        },
      ],
    },
  },
)
