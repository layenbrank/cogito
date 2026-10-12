import eslint from '@eslint/js'
import { defineConfig, globalIgnores } from 'eslint/config'
import { fileURLToPath } from 'node:url'
import tseslint from 'typescript-eslint'

/** 本包为侧车产物的契约（纯数据 + 校验）：与 app 侧同规则（含禁箭头函数） */
export default defineConfig([
  globalIgnores(['dist', 'coverage', 'node_modules']),
  eslint.configs.recommended,
  tseslint.configs.recommended,

  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: 2025,
        projectService: true,
        tsconfigRootDir: fileURLToPath(new URL('.', import.meta.url))
      }
    },
    rules: {
      eqeqeq: 'error',
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ArrowFunctionExpression',
          message:
            'Arrow functions are not allowed. Use function declarations or function expressions.'
        }
      ],
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_'
        }
      ]
    }
  }
])
