import js from '@eslint/js';
import globals from 'globals';
import hooks from 'eslint-plugin-react-hooks';

export default [
  { ignores: ['dist/**', 'node_modules/**', '.tools/**', '.abacusai/**'] },
  { files: ['src/**/*.{js,jsx}', 'server/**/*.js', 'tests/**/*.js', 'vite.config.js'], languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: { ...globals.browser, ...globals.node }, parserOptions: { ecmaFeatures: { jsx: true } } }, plugins: { 'react-hooks': hooks }, rules: { ...js.configs.recommended.rules, ...hooks.configs.recommended.rules, 'no-unused-vars': 'off', 'no-control-regex': 'off', 'no-empty': ['error', { allowEmptyCatch: true }] } }
];
