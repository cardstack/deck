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
  ignorePatterns: ['node_modules/', 'reference/'],
};
