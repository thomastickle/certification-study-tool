import js from '@eslint/js'
import stylistic from '@stylistic/eslint-plugin'
import { defineConfig, globalIgnores } from 'eslint/config'
import prettier from 'eslint-config-prettier'
import tseslint from 'typescript-eslint'

const declarations = [
  'function',
  'function-overload',
  { selector: 'ClassDeclaration' },
  { selector: 'TSInterfaceDeclaration' },
  { selector: 'TSTypeAliasDeclaration' },
  { selector: 'TSEnumDeclaration' },
  'export',
  {
    selector:
      'VariableDeclaration:has(VariableDeclarator > :matches(ArrowFunctionExpression, FunctionExpression).init)',
  },
]

export default defineConfig([
  globalIgnores(['private/**', 'dist/**', 'build/**', 'node_modules/**']),
  {
    files: ['**/*.{js,mjs,cjs,ts,tsx}'],
    extends: [js.configs.recommended, tseslint.configs.recommended, prettier],
    plugins: { '@stylistic': stylistic },
    rules: {
      '@stylistic/padding-line-between-statements': [
        'error',
        { blankLine: 'always', prev: 'import', next: '*' },
        { blankLine: 'any', prev: 'import', next: 'import' },
        { blankLine: 'always', prev: '*', next: declarations },
        { blankLine: 'always', prev: declarations, next: '*' },
        {
          blankLine: 'any',
          prev: [
            'function-overload',
            { selector: 'ExportNamedDeclaration[declaration.type="TSDeclareFunction"]' },
          ],
          next: ['function-overload', 'function', 'export'],
        },
      ],
      '@stylistic/lines-between-class-members': [
        'error',
        {
          enforce: [
            { blankLine: 'always', prev: '*', next: 'method' },
            { blankLine: 'always', prev: 'method', next: '*' },
          ],
        },
        { exceptAfterOverload: true },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
    },
  },
])
