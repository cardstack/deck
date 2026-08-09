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
        'packages/core/src/index.ts',
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
      // The layering the ban now rests on is `core ← server ← tools`. Tools
      // sits ABOVE the server: the rebase daemon operates a mounted depot,
      // and `depot-policy.ts` reads a depot's cooldown file. So a server
      // module reaching for `@cardstack/deck-tools` is not merely a compat
      // leak, it is a cycle — which is why one pattern covers both.
      files: ['packages/server/src/**/*.ts'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                group: ['@cardstack/deck-tools', '@cardstack/deck-tools/*'],
                message:
                  'Tools runs ABOVE the server (core ← server ← tools). Vendoring, npm carriage and derivation are intake work, not serve work (docs/deck-embroider-lessons.md §3).',
              },
              {
                group: ['@cardstack/deck/vendor', '@cardstack/deck/vendor-*'],
                message:
                  'Byte carriage is intake work, not serve work — put it in vendor/CLI/Tools (docs/deck-embroider-lessons.md §3).',
              },
            ],
          },
        ],
      },
    },
    {
      // Core is the half that gets backported, so it stays a leaf.
      //
      // Everything above it — the server, Tools, the CLI — is this repo's
      // reference implementation, and Boxel brings its own. An edge from
      // Core to any of them would drag a package Boxel is not taking into
      // the cone of the one it is.
      files: ['packages/core/src/**/*.ts'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                group: ['@cardstack/deck-*', '@cardstack/deck-*/*'],
                message:
                  'Core is a leaf: it is the package that moves into the Boxel monorepo, so it cannot depend on the reference server, Tools or the CLI.',
              },
            ],
          },
        ],
      },
    },
  ],
  ignorePatterns: ['node_modules/', 'reference/'],
};
