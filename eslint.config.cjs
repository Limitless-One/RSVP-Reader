const tsParser = require('@typescript-eslint/parser');
const tsPlugin = require('@typescript-eslint/eslint-plugin');

module.exports = [
  {
    files: ['src/**/*.ts', 'tests/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        chrome: 'readonly',
        console: 'readonly',
        document: 'readonly',
        window: 'readonly',
        location: 'readonly',
        performance: 'readonly',
        HTMLElement: 'readonly',
        HTMLButtonElement: 'readonly',
        HTMLDivElement: 'readonly',
        HTMLInputElement: 'readonly',
        HTMLSelectElement: 'readonly',
        FileReader: 'readonly',
        Blob: 'readonly',
        URL: 'readonly',
        CSS: 'readonly',
        CustomEvent: 'readonly',
        KeyboardEvent: 'readonly',
        WheelEvent: 'readonly',
        MouseEvent: 'readonly',
        ParentNode: 'readonly',
        Event: 'readonly',
        MutationObserver: 'readonly',
        IDBDatabase: 'readonly',
        indexedDB: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        confirm: 'readonly',
        alert: 'readonly',
        describe: 'readonly',
        expect: 'readonly',
        it: 'readonly',
        test: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
    },
  },
  {
    ignores: ['dist/**', 'node_modules/**'],
  },
];
