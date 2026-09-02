import { defineConfig } from '@rstest/core';

export default defineConfig({
  testEnvironment: 'node',
  include: ['src/**/*.test.ts'],
  exclude: [
    '**/node_modules/**',
  ],
  pool: {
    maxWorkers: 1,
  },
});
