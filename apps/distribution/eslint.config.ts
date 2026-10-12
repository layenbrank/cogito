import eslint from '@eslint/js'
import { defineConfig, globalIgnores } from 'eslint/config'
import { fileURLToPath } from 'node:url'
import tseslint from 'typescript-eslint'

/** Worker 与上传脚本同规则（与 app 侧一致，含禁箭头函数）；`.wrangler` 是 wrangler 的本地状态 */
export default defineConfig([
  globalIgnores(['dist', 'coverage', 'node_modules', '.wrangler', 'worker-configuration.d.ts']),
  eslint.configs.recommended,
  tseslint.configs.recommended,

  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: 2025,
        project: ['./tsconfig.worker.json', './tsconfig.scripts.json'],
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
