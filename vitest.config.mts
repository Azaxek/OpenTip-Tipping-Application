import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@': path.resolve(process.cwd(), 'src') } },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    fileParallelism: false, // sequential: files share one temp storage dir per process
    testTimeout: 30000,
    hookTimeout: 60000,
    coverage: {
      provider: 'v8',
      // The business logic and the public API. Pages and components are checked by the type system, the linter and the browser walkthroughs.
      include: ['src/lib/**', 'src/app/api/**'],
      exclude: [
        'src/lib/card.ts', // runs only in the browser (builds the PDF receipt)
        'src/lib/client-image.ts', // runs only in the browser (canvas)
        'src/lib/session.ts', // thin wrapper over Next's cookies()/headers()
        'src/lib/flash.ts', // wraps Next's redirect()
        'src/lib/i18n/route.ts', // wraps Next's notFound()
        'src/app/api/dev-upload/**', // local-development upload stand-in
        'src/lib/wordlist.ts', // data
      ],
      reporter: ['text-summary', 'lcov'],
      // A floor just under today's measured numbers: it can only go up. Raise it when you add tests; never lower it to make a build pass.
      thresholds: { statements: 85, branches: 76, functions: 85, lines: 88 },
    },
  },
});
