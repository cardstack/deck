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
  },
  ignorePatterns: ['node_modules/', 'reference/'],
};
