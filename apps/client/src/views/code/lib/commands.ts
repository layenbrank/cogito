import { toast } from 'sonner'

import { useCodeStore } from '@/stores/code'
import { useTerminalStore } from '@/stores/terminal'
import { pickOpenFile, pickRootDirectory, writeCodeFile } from '@/views/code/lib/fs.ts'
import { disposeModel, findModel } from '@/views/code/lib/monaco-models.ts'
import { openAbsolutePath } from '@/views/code/lib/open-file.ts'

interface CodeCommand {
  id: string
  title: string
  keywords?: string
  run(): void | Promise<void>
}

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
  const tab = store.tabs.find(function (item) {
    return item.id === store.activeTabId
  })
  if (!tab) return
  if (tab.isDirty) {
    const confirmed = window.confirm(`「${tab.title}」有未保存更改，确定关闭？`)
    if (!confirmed) return
  }
  disposeModel(tab.path)
  store.toCloseTab(tab.id)
}

function toggleTerminal(): void {
  const store = useCodeStore.getState()
  const willOpen = !(store.isPanelOpen && store.panelTab === 'terminal')
  store.toTogglePanel('terminal')
  if (willOpen) {
    const root = store.workspaceRoot
    if (root && useTerminalStore.getState().tabs.length === 0) {
      useTerminalStore.getState().newTab(root)
    }
  }
}

const CODE_COMMANDS: CodeCommand[] = [
  {
    id: 'file.open',
    title: '文件: 打开文件…',
    keywords: 'open file',
    run: openFileDialog
  },
  {
    id: 'file.openFolder',
    title: '文件: 打开文件夹…',
    keywords: 'open folder workspace',
    run: openFolderDialog
  },
  {
    id: 'file.save',
    title: '文件: 保存',
    keywords: 'save',
    run: saveActiveTab
  },
  {
    id: 'file.closeTab',
    title: '文件: 关闭当前标签',
    keywords: 'close tab',
    run: closeActiveTab
  },
  {
    id: 'view.toggleSidebar',
    title: '查看: 切换侧栏（Ctrl+B）',
    keywords: 'sidebar toggle ctrl+b',
    run: function () {
      useCodeStore.getState().toToggleSidebar()
    }
  },
  {
    id: 'view.explorer',
    title: '查看: 资源管理器',
    keywords: 'explorer files',
    run: function () {
      useCodeStore.getState().toSetSidebarView('explorer')
    }
  },
  {
    id: 'view.search',
    title: '查看: 搜索',
    keywords: 'search',
    run: function () {
      useCodeStore.getState().toSetSidebarView('search')
    }
  },
  {
    id: 'view.terminal',
    title: '查看: 切换终端',
    keywords: 'terminal panel',
    run: toggleTerminal
  },
  {
    id: 'view.problems',
    title: '查看: 问题',
    keywords: 'problems markers',
    run: function () {
      useCodeStore.getState().toTogglePanel('problems')
    }
  },
  {
    id: 'palette.files',
    title: '转到文件…',
    keywords: 'quick open go to file',
    run: function () {
      useCodeStore.getState().toSetPaletteMode('file')
    }
  }
]

function findCommands(query: string): CodeCommand[] {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return CODE_COMMANDS
  return CODE_COMMANDS.filter(function (command) {
    const haystack = `${command.title} ${command.keywords ?? ''} ${command.id}`.toLowerCase()
    return haystack.includes(normalized)
  })
}

async function runCommand(id: string): Promise<void> {
  const command = CODE_COMMANDS.find(function (item) {
    return item.id === id
  })
  if (!command) return
  await command.run()
}

export {
  CODE_COMMANDS,
  findCommands,
  runCommand,
  saveActiveTab,
  openFileDialog,
  openFolderDialog,
  closeActiveTab,
  toggleTerminal,
  openAbsolutePath
}
export type { CodeCommand }
