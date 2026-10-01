import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/*
 * `@/*` mirrors the tsconfig path alias so component source imports resolve identically under
 * Vitest and under Next's bundler. Without it every test of a `@/`-importing component fails to
 * resolve rather than failing on its assertions.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./test/setup.ts'],
    include: ['**/*.test.{ts,tsx}'],
  },
});
