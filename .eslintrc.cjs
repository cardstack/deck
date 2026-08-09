'use strict';

module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  env: {
    node: true,
    es2022: true,
  },
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
  rules: {
    // House style follows the boxel monorepo: `let` is the default binding.
    'prefer-const': 'off',
    // An `_`-prefixed parameter is a deliberate part of a signature the
    // implementation does not use — interface parity, mostly.
    '@typescript-eslint/no-unused-vars': [
      'error',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
    ],
  },
  overrides: [
    {
      // The browser-safe surface of Deck Core.
      //
      // A host that brings its own module loader — rather than letting the
      // browser apply a native import map — has to run the resolution
      // algorithm itself, in the page. So these modules, and everything they
      // reach, must load in a browser. A `node:` import here costs nothing
      // in this repo and fails in the consumer months later, as a bundler
      // error nobody can place. Hence a rule rather than a comment.
      //
      // Adding a file to this list is a promise about its whole import
      // closure, not just its first line. Check what it reaches.
      files: [
        'packages/core/src/resolve.ts',
        'packages/core/src/inherit.ts',
        'packages/core/src/classify.ts',
        'packages/core/src/pack-mode.ts',
        'packages/core/src/import-map.ts',
        'packages/core/src/merge.ts',
        'packages/core/src/es-lexer.ts',
      ],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                group: ['node:*'],
                message:
                  'Part of the browser-safe surface (see packages/core/src/resolve.ts). Put the Node-only half in a sibling module.',
              },
            ],
          },
        ],
      },
    },
    {
      // Compat stays out of the serve path.
      //
      // Normalising npm's shapes — dual `exports`, browser vs module vs
      // main, CJS interop — is intake work. It belongs to vendoring, the
      // CLI and Tools, where it runs once and reports what it lost. The
      // server does one job: live tree, `@exact`, tags, digests, maps,
      // Timeline.
      //
      // The rule exists because the pressure to relax it is constant and
      // sounds reasonable every single time: one package almost works, so
      // the server learns one more shape. That is how a forever compat
      // layer grows, and Embroider spent eight years carrying one. A
      // behaviour that genuinely needs best effort is a vendor flag with an
      // explicit lossy report, never a quiet branch in serve.
      //
      // `@deck/core/npm` is deliberately absent from this list: `depot.ts`
      // reads the cooldown POLICY from it, which is depot configuration
      // rather than package normalisation. It lives in npm.ts for
      // historical reasons and would read better extracted — tidying, not a
      // boundary violation.
      files: ['packages/server/src/**/*.ts'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                group: [
                  '@deck/core/vendor',
                  '@deck/core/vendor-*',
                  '@deck/core/derive',
                ],
                message:
                  'Compat and derivation are intake work, not serve work — put it in vendor/CLI/Tools (docs/deck-embroider-lessons.md §3).',
              },
            ],
          },
        ],
      },
    },
  ],
  ignorePatterns: ['node_modules/', 'reference/'],
};
