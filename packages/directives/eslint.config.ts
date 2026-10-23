import eslint from '@eslint/js'
import { defineConfig, globalIgnores } from 'eslint/config'
import globals from 'globals'
import tseslint from 'typescript-eslint'

/**
 * @cogito/hooks（Vue 侧共享 hooks 包）的 ESLint 9 flat config。
 *
 * 这里用非类型感知的 recommended：本包的文件不全在 tsconfig 里（`index.ts` / `scripts/**`），
 * 开 projectService 会直接报 “not found by the project service”。
 */
export default defineConfig([
  globalIgnores(['dist', 'node_modules', 'coverage', 'eslint.config.ts']),
  eslint.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node }
    },
    rules: {
      eqeqeq: 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }
      ]
    }
  }
])
