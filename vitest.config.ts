import { defineConfig } from 'vitest/config'

// Three projects mirror TESTING.md layers: unit tests live next to pure
// source files, integration and realtime tests live under tests/.
// Layers that do not exist yet pass via --passWithNoTests in package scripts.
export default defineConfig({
  test: {
    passWithNoTests: true,
    projects: [
      {
        test: {
          name: 'unit',
          environment: 'node',
          include: ['src/**/*.test.{ts,tsx}'],
        },
      },
      {
        test: {
          name: 'integration',
          environment: 'node',
          include: ['tests/integration/**/*.test.ts'],
          exclude: ['tests/integration/realtime-*.test.ts'],
        },
      },
      {
        test: {
          name: 'realtime',
          environment: 'node',
          include: ['tests/integration/realtime-*.test.ts'],
        },
      },
    ],
  },
})
