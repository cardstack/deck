'use strict';

module.exports = {
  singleQuote: true,
  overrides: [
    {
      files: ['*.yaml', '*.yml'],
      options: {
        singleQuote: false,
      },
    },
  ],
};
