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
        // Monaco 必须静态挂 worker（悬停/诊断/补全都依赖同一个实例），无法改成按需 import
        files: [
          'src/lib/monaco-environment.ts',
          'src/lib/monaco-theme.ts',
          'src/views/code/workspace/code.tsx',
          'src/views/code/lib/monaco-models.ts',
          'src/views/code/workspace/monaco-host.tsx',
          'src/views/code/workspace/problems.tsx',
          'src/views/knowledge/workspace/source-editor.tsx'
        ],
        rules: ['react-doctor/prefer-dynamic-import']
      },
      {
        // 有意逐条串行：
        // - agent-loop / morph：同一会话的 ACP 请求必须按用户顺序发出
        // - attachment：附加顺序 = 用户选择顺序，并行会让会话里的文件顺序错乱
        // - stores/gallery：日期补齐是后台清扫，逐条探测 + 逐条落库，避免并发拉起大量探测进程
        // - code/lib/fs：深度遍历要在达到条数上限时立刻停止，改并行会破坏 limit 语义
        files: [
          'src/features/agent/model/agent-loop.ts',
          'src/stores/morph.ts',
          'src/features/agent/attachment.ts',
          'src/stores/gallery.ts',
          'src/views/code/lib/fs.ts'
        ],
        rules: ['react-doctor/async-await-in-loop']
      },
      {
        // 复位本来就在 finally 里，只是外面套了 `if (!cancelled)` 守卫（effect 重跑/卸载后不再碰 state）。
        // 分析器看不穿这个守卫；去掉守卫又会撞上 no-state-update-after-await-in-effect，故此处显式豁免。
        files: [
          'src/views/agent/chat/components/composer-context-menu.tsx',
          'src/views/agent/chat/components/composer-triggers.tsx',
          'src/views/agent/chat/components/workspace-file-picker.tsx',
          'src/views/agent/settings/sections/extensions.tsx',
          'src/views/agent/settings/sections/tool-permissions.tsx'
        ],
        rules: ['react-doctor/no-loading-flag-reset-outside-finally']
      },
      {
        // 全局键注册/回滚共用一个串行队列与 activeBindings，必须逐个执行；并行会与管理器状态竞态
        files: ['src/keyboard/global.ts'],
        rules: ['react-doctor/async-await-in-loop']
      },
      {
        // 编排卡整块可点是有意的，键盘路径由卡内的「打开」按钮承担（Tab 可达、Enter 触发）。
        // 不能用 `absolute inset-0` 的透明按钮接管点击 —— 曾经这么干过，被同层焦点按钮盖死，整张卡点不开
        // （见 card.test.tsx 里的教训注释），所以这里显式豁免而不是改结构。
        files: ['src/views/directive/library/card.tsx'],
        rules: [
          'react-doctor/no-static-element-interactions',
          'react-doctor/click-events-have-key-events'
        ]
      }
    ]
  }
})
