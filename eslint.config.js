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
      // `configs.flat` is the flat-config shape; `configs['recommended-latest']`
      // is still the eslintrc one in v7 and ESLint 10 refuses it.
      reactHooks.configs.flat['recommended-latest'],
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
      /* Rules eslint-plugin-react-hooks 7 brought in with the React Compiler
         pass, plus ESLint 10's two new ones. Each is a real finding, not
         noise, and each is left at `warn` so the count stays visible and the
         gate stays green until somebody works through them:

           react-hooks/refs                        49
           react-hooks/set-state-in-effect         44
           no-useless-assignment                   19
           preserve-caught-error                    17
           react-hooks/preserve-manual-memoization 15
           react-hooks/immutability                15
           react-hooks/purity                      11
           react-hooks/static-components            1

         Counted on 2026-09-16 over 66 files; the numbers are in
         docs/handoffs/phase-2-upgrade.md. */
      'react-hooks/refs': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/preserve-manual-memoization': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/static-components': 'warn',
      'no-useless-assignment': 'warn',
      'preserve-caught-error': 'warn',
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
