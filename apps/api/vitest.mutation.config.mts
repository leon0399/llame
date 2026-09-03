import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.test.ts'],
    exclude: [
      'src/**/*.integration.test.ts',
      'src/instance-config/config-loader.test.ts',
      'src/instance-config/knowledge-config.test.ts',
      'src/mcp/mcp-runtime.module.test.ts',
    ],
    maxWorkers: 4,
    testTimeout: 180_000,
    hookTimeout: 180_000,
  },
});
