import eslint from '@eslint/js'
import ith from '@cogito/eslint-plugin'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import { fileURLToPath } from 'node:url'

const ROOT_DIR = fileURLToPath(new URL('.', import.meta.url))

/**
 * Client ESLint：type-checked + projectService，与 tsconfig.app / tsconfig.node 对齐。
 * 打包闸门（build:core）只拦 error；存量 unsafe/React Compiler 类规则降为 warn，二期再收紧。
 */
export default defineConfig(
  globalIgnores([
    'src/components/tiptap-ui/**',
    'src/components/tiptap-node/**',
    'src/components/tiptap-ui-primitive/**',
    '**/dist/**',
    '**/dist-ssr/**',
    '**/coverage/**',
    '**/node_modules/**',
    '**/src-tauri/**',
    'chunks.log',
    // 根目录工具配置多为 plain JS，不参与 type-checked 规则
    '*.config.js',
    '*.config.cjs',
    '*.config.mjs',
    'postcss.config.*',
    // Tailwind/bump 工具文件：大量 plugin API any，不进打包闸门
    'tailwind.config.ts',
    'bump.client.ts'
  ]),
  eslint.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  reactHooks.configs.flat['recommended-latest'],
  reactRefresh.configs.recommended,
  reactRefresh.configs.vite,
  {
    name: 'client/typescript',
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tseslint.parser,
      globals: {
        ...globals.browser
      },
      parserOptions: {
        ecmaVersion: 2025,
        sourceType: 'module',
        projectService: true,
        tsconfigRootDir: ROOT_DIR
      }
    },
    plugins: {
      '@typescript-eslint': tseslint.plugin
    },
    rules: {
      'no-var': 'error',
      eqeqeq: 'error',
      'no-unused-vars': 'off',

      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-namespace': 'off',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        {
          prefer: 'type-imports',
          fixStyle: 'separate-type-imports'
        }
      ],
      /* React 事件/props 常写 async handler，关闭 attributes 上的 Promise 误报 */
      '@typescript-eslint/no-misused-promises': [
        'error',
        {
          checksVoidReturn: {
            attributes: false
          }
        }
      ],
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_'
        }
      ],

      /* ── 打包闸门：存量噪声降为 warn（二期再升 error） ── */
      '@typescript-eslint/unbound-method': 'warn',
      '@typescript-eslint/no-unsafe-return': 'warn',
      '@typescript-eslint/no-unsafe-assignment': 'warn',
      '@typescript-eslint/no-unsafe-member-access': 'warn',
      '@typescript-eslint/no-unsafe-call': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      '@typescript-eslint/no-unnecessary-type-assertion': 'warn',
      '@typescript-eslint/no-redundant-type-constituents': 'warn',
      '@typescript-eslint/require-await': 'warn',
      '@typescript-eslint/no-base-to-string': 'warn',
      '@typescript-eslint/prefer-promise-reject-errors': 'warn',
      'react-refresh/only-export-components': 'off',
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/purity': 'warn'
    }
  },
  {
    name: 'client/node-tooling',
    files: [
      'vite.config.*',
      'vite.chunk.*',
      'vitest.config.*',
      'playwright.config.*',
      'eslint.config.*',
      'doctor.config.*',
      'scripts/**/*.{ts,mts}'
    ],
    languageOptions: {
      globals: {
        ...globals.node
      }
    }
  },
  {
    // 放在最后：catch 一律不许静默吃掉（throw 出去，或至少输出一次）。
    // 与 studio 一致，全域 error —— 存量已清完，不再分档。
    name: 'client/catch-must-report',
    files: ['**/*.{ts,tsx,mts,cts}'],
    plugins: { ith },
    rules: {
      'ith/catch-must-report': 'error',
      'ith/no-scrollbar-width-thin': 'error'
    }
  },
  {
    name: 'client/no-web-storage',
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/**/*.{test,spec}.{ts,tsx}', 'src/__test__/**'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "CallExpression[callee.object.name='localStorage'][callee.property.name=/^(get|set|remove)Item$/]",
          message:
            '禁止业务路径使用 localStorage；非密偏好走 @/features/persist，密钥走 secrets/Keyring。'
        },
        {
          selector:
            "CallExpression[callee.object.name='sessionStorage'][callee.property.name=/^(get|set|remove)Item$/]",
          message:
            '禁止业务路径使用 sessionStorage；JWT 走 OS Keyring + 内存 cache（@/features/persist/secrets）。'
        }
      ]
    }
  }
)
