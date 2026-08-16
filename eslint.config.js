/** ESLint, flat config.
 *
 * Deliberately small: the repo's real gates are the type-checker (strict, with
 * noUncheckedIndexedAccess) and the test suite. This lint exists for the things
 * a contributor trips on that neither of those catch — `==` where `===` was
 * meant, a `var` or a `console.log` left in, a variable imported and never
 * used. The underscore-prefix rule matters here: `_callId` and `_signal` are
 * the codebase's own convention for an argument a signature requires but a
 * body never reads, and it appears in every tool.
 */

import eslint from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'dist-electron/**',
      'release/**',
      'build/**',
      'node_modules/**',
      'coverage/**',
      '.screenshots/**',
    ],
  },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      eslint.configs.recommended,
      ...tseslint.configs.recommended,
      // App.tsx carries one deliberate disable for the effect that must run
      // exactly once; everything else here is expected to obey the rules.
      reactHooks.configs['recommended-latest'],
    ],
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      eqeqeq: ['error', 'smart'],
      'prefer-const': 'error',
      'no-var': 'error',
      'no-debugger': 'error',
      // The main process and the build scripts log on purpose; the renderer
      // keeps its own quiet. Off here rather than per file.
      'no-console': 'off',
    },
  },
  {
    // The plain-JavaScript files (build scripts, this config, the electron
    // entry) get the syntax-level rules only — ESLint's recommended set wants
    // a browser or node environment declared, and these are too small to need
    // the ceremony.
    files: ['**/*.{js,mjs,cjs}'],
    rules: {
      'no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      eqeqeq: ['error', 'smart'],
      'prefer-const': 'error',
      'no-var': 'error',
      'no-debugger': 'error',
      'no-console': 'off',
    },
  },
);
