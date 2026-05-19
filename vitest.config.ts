import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: [
        'src/types/**',
        'src/agents/index.ts',
        'src/context/index.ts',
        'src/files/index.ts',
        'src/iteration/index.ts',
        'src/logging/index.ts',
        'src/model/index.ts',
        'src/monitor/index.ts',
        'src/parser/index.ts',
        'src/sandbox/index.ts',
      ],
      reporter: ['text', 'text-summary', 'lcov'],
      thresholds: {
        functions: 98,
        lines: 99,
      },
    },
  },
});
