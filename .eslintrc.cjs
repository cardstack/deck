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
  ],
  ignorePatterns: ['node_modules/', 'reference/'],
};
