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
    /* Enough for anything that only touches a temp folder. The few suites that
       walk node_modules or start real processes ask for longer themselves, with
       `vi.setConfig` at the top of the file, so a test that hangs here is red in
       ten seconds rather than thirty. */
    testTimeout: 10_000,
  },
});
