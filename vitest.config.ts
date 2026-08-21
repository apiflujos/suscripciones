import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Los componentes del admin usan el runtime automático de JSX, igual que Next.
  esbuild: { jsx: 'automatic' },
  test: {
    globals: true,
    environment: 'node',
    include: ['packages/core/src/**/__tests__/**/*.test.ts', 'apps/admin/app/**/__tests__/**/*.test.ts'],
    exclude: ['node_modules', 'dist'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      threshold: {
        lines: 40,
        functions: 40,
        branches: 40,
        statements: 40
      }
    }
  }
});
