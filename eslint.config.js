const js      = require('@eslint/js')
const globals = require('globals')

module.exports = [
  { ignores: ['node_modules/**'] },

  js.configs.recommended,

  {
    languageOptions: {
      globals: { ...globals.node, ...globals.commonjs },
      parserOptions: { ecmaVersion: 2022 },
    },
    rules: {
      'no-redeclare':  'error',
      'no-undef':      'error',
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
]
