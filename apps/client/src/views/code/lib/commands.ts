/**
 * code 窗的命令表。
 *
 * 这里只声明「做什么」与元信息；键位在 `keyboard/definitions.ts` 里按 id 关联，
 * 派发、检索与执行都由 `keyboard/commands.ts` 负责 —— 所以不再自带 `findCommands`/`runCommand`，
 * 命令面板也直接用注册表（命令与快捷键共用一份定义，不会再出现「标题里手写 Ctrl+B」这种漂移）。
 *
 * 由 `Code` 挂载时 `useCommands(CODE_COMMANDS)` 注册：没打开 code 窗时它们不出现在面板里。
 */
import { toast } from 'sonner'

import { SHORTCUT_COMMAND } from '@/keyboard/definitions'
import type { Command } from '@/keyboard/types'
import { useCodeStore } from '@/stores/code'
import { useTerminalStore } from '@/stores/terminal'
import { pickOpenFile, pickRootDirectory, writeCodeFile } from '@/views/code/lib/fs.ts'
import { requestCloseTabs } from '@/views/code/lib/close-tabs.ts'
import { findModel } from '@/views/code/lib/monaco-models.ts'
import { runEditorAction } from '@/views/code/lib/monaco-instance.ts'
import { openAbsolutePath } from '@/views/code/lib/open-file.ts'

async function saveActiveTab(): Promise<void> {
  const store = useCodeStore.getState()
  const tab = store.tabs.find(function (item) {
    return item.id === store.activeTabId
  })
  if (!tab) {
    toast.message('没有可保存的文件')
    return
  }
  const model = findModel(tab.path)
  if (!model) {
    toast.error('编辑器模型不存在')
    return
  }
  if (useCodeStore.getState().isLargeFile) {
    toast.message('文件过大，已以只读方式打开')
    return
  }
  await writeCodeFile(tab.path, model.getValue())
  store.toMarkSaved(tab.id)
  toast.success('已保存')
}

async function openFileDialog(): Promise<void> {
  const path = await pickOpenFile()
  if (!path) return
  await openAbsolutePath(path)
}

async function openFolderDialog(): Promise<void> {
  const root = await pickRootDirectory()
  if (!root) return
  useCodeStore.getState().toSetWorkspaceRoot(root)
  useCodeStore.getState().toBumpTree()
  useCodeStore.getState().toSetSidebarView('explorer')
  toast.success('已打开文件夹')
}

function closeActiveTab(): void {
  const store = useCodeStore.getState()
  if (!store.activeTabId) return
  requestCloseTabs([store.activeTabId])
}

function toggleTerminal(): void {
  const store = useCodeStore.getState()
  const willOpen = !(store.isSurfaceOpen && store.surfaceTab === 'terminal')
  store.toToggleSurface('terminal')
  if (willOpen) {
    const root = store.workspaceRoot
    if (root && useTerminalStore.getState().tabs.length === 0) {
      useTerminalStore.getState().newTab(root)
    }
  }
}

/** 命令面板：命令模式与文件模式各一个命令，快捷键在键位表里关联 */
function openCommandPalette(): void {
  useCodeStore.getState().toSetPaletteMode('command')
}

function openFilePalette(): void {
  useCodeStore.getState().toSetPaletteMode('file')
}

/**
 * 查找 / 替换面板由 Monaco 原生提供。
 *
 * 这里只做「命令面板可调起」：Ctrl+F / Ctrl+H 交给 Monaco 自己的键位，
 * 若再注册到全局派发器，一次按键会触发两次。
 */
function openFindWidget(isReplace: boolean): void {
  const actionID = isReplace ? 'editor.action.startFindReplaceAction' : 'actions.find'
  if (runEditorAction(actionID)) return
  toast.message('先打开一个文件')
}

const CODE_COMMANDS: Command[] = [
  {
    id: SHORTCUT_COMMAND.CODE_OPEN_FILE,
    title: '文件: 打开文件…',
    keywords: 'open file',
    group: '文件',
    run: openFileDialog
  },
  {
    id: SHORTCUT_COMMAND.CODE_OPEN_FOLDER,
    title: '文件: 打开文件夹…',
    keywords: 'open folder workspace',
    group: '文件',
    run: openFolderDialog
  },
  {
    id: SHORTCUT_COMMAND.CODE_SAVE,
    title: '文件: 保存',
    keywords: 'save',
    group: '文件',
    run: saveActiveTab
  },
  {
    id: SHORTCUT_COMMAND.CODE_CLOSE_TAB,
    title: '文件: 关闭当前标签',
    keywords: 'close tab',
    group: '文件',
    run: closeActiveTab
  },
  {
    id: SHORTCUT_COMMAND.CODE_FIND,
    title: '编辑: 查找',
    keywords: 'find search',
    group: '编辑',
    run: function () {
      openFindWidget(false)
    }
  },
  {
    id: SHORTCUT_COMMAND.CODE_FIND_REPLACE,
    title: '编辑: 查找并替换',
    keywords: 'find replace',
    group: '编辑',
    run: function () {
      openFindWidget(true)
    }
  },
  {
    id: SHORTCUT_COMMAND.CODE_PALETTE_COMMANDS,
    title: '显示所有命令…',
    keywords: 'command palette',
    group: '查看',
    run: openCommandPalette
  },
  {
    id: SHORTCUT_COMMAND.CODE_PALETTE_FILES,
    title: '转到文件…',
    keywords: 'quick open go to file',
    group: '查看',
    run: openFilePalette
  },
  {
    id: SHORTCUT_COMMAND.CODE_TOGGLE_SIDEBAR,
    title: '查看: 切换侧栏',
    keywords: 'sidebar toggle',
    group: '查看',
    run: function () {
      useCodeStore.getState().toToggleSidebar()
    }
  },
  {
    id: SHORTCUT_COMMAND.CODE_EXPLORER,
    title: '查看: 资源管理器',
    keywords: 'explorer files',
    group: '查看',
    run: function () {
      useCodeStore.getState().toSetSidebarView('explorer')
    }
  },
  {
    id: SHORTCUT_COMMAND.CODE_SEARCH,
    title: '查看: 搜索',
    keywords: 'search',
    group: '查看',
    run: function () {
      useCodeStore.getState().toSetSidebarView('search')
    }
  },
  {
    id: SHORTCUT_COMMAND.CODE_SCM,
    title: '查看: 源代码管理',
    keywords: 'git scm source control',
    group: '查看',
    run: function () {
      useCodeStore.getState().toSetSidebarView('scm')
    }
  },
  {
    id: SHORTCUT_COMMAND.CODE_TERMINAL,
    title: '查看: 切换终端',
    keywords: 'terminal panel',
    group: '查看',
    run: toggleTerminal
  },
  {
    id: SHORTCUT_COMMAND.CODE_PROBLEMS,
    title: '查看: 问题',
    keywords: 'problems markers',
    group: '查看',
    run: function () {
      useCodeStore.getState().toToggleSurface('problems')
    }
  },
  {
    id: SHORTCUT_COMMAND.CODE_GIT_SEARCH,
    title: '查看: 提交历史',
    keywords: 'git search commits history hash author message gitlens 提交',
    group: '查看',
    run: function () {
      useCodeStore.getState().toOpenCommitsTab()
    }
  }
]

export {
  CODE_COMMANDS,
  saveActiveTab,
  openFileDialog,
  openFolderDialog,
  closeActiveTab,
  toggleTerminal,
  openAbsolutePath
}
