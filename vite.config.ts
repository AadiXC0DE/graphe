import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Relative, because the shipped app loads index.html off the disk rather than
  // off a server. Vite's default absolute paths resolve against the filesystem
  // root under file://, which is a blank window and no error worth reading.
  base: './',
  plugins: [react()],
  server: { port: 5273, strictPort: true },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    /* Well past what any test here needs. A handful walk node_modules or start
       real processes, and under a full parallel run they were losing a race
       with the five-second default — a red build about machine load rather than
       about the code. A test that genuinely hangs still fails, just later. */
    testTimeout: 30_000,
  },
});
