import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * What is kept out of the file the window waits for.
 *
 * The main chunk is what has to be read, parsed and run before anything is on
 * screen, so the rule is: nothing eager that is not needed to draw the first
 * frame. React is the exception — the window cannot start without it — and it
 * sits in its own file because it changes about once a year while the app
 * changes daily, so an update re-fetches the app and not the framework.
 *
 * The heavy libraries the targets name — mermaid, cytoscape, katex, shiki and
 * the grammars — are deliberately NOT listed here. Every one of them is already
 * out of the main chunk, and each ships its own on-demand pieces: mermaid loads
 * one diagram type, shiki loads one grammar. Naming them here would weld those
 * pieces back into a single file and turn a 640 KB fetch-when-asked into a
 * 2.5 MB one. `scripts/perf-report.mjs --check` is what keeps them out of the
 * main chunk; grouping them would only make each one bigger.
 */
const APART: Readonly<Record<string, string>> = {
  react: 'react',
  'react-dom': 'react',
  scheduler: 'react',
};

/** The package a bundled file came from, or null for our own code. */
function packageOf(id: string): string | null {
  const at = id.lastIndexOf('node_modules/');
  if (at < 0) return null;
  const rest = id.slice(at + 'node_modules/'.length);
  const parts = rest.split('/');
  const name = rest.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
  return name === undefined || name === '' ? null : name;
}

export default defineConfig({
  // Relative, because the shipped app loads index.html off the disk rather than
  // off a server. Vite's default absolute paths resolve against the filesystem
  // root under file://, which is a blank window and no error worth reading.
  base: './',
  plugins: [react()],
  server: { port: 5273, strictPort: true },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          const name = packageOf(id);
          return name === null ? undefined : APART[name];
        },
      },
    },
  },
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
