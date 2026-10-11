import { defineConfig } from 'react-doctor/api'

/**
 * React Doctor 配置（apps/client）
 *
 * `host.tsx`：oxlint-plugin-react-doctor 在分析 `<MenuLayer …>` 用法时会抛
 * `Cannot read properties of undefined (reading 'type')`，整次 lint 批次失败。
 * 排除该文件后其余源码可完整扫描；待上游插件修复后移除此忽略。
 *
 * `src-tauri/.cursor/**`：agent skill / 工具脚本，不是客户端产物。
 */
export default defineConfig({
  ignore: {
    files: ['src/components/contextmenu/host.tsx', 'src-tauri/.cursor/**'],
    // Monaco 必须静态挂 worker；agent-loop / morph 串行 await 为有意语义
    overrides: [
      {
        files: ['src/views/code/workspace/code.tsx'],
        rules: ['react-doctor/prefer-dynamic-import']
      },
      {
        files: ['src/features/agent/model/agent-loop.ts', 'src/stores/morph.ts'],
        rules: ['react-doctor/async-await-in-loop']
      }
    ]
  }
})
