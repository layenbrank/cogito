/**
 * 剪辑窗的命令接线。
 *
 * 原来是手写的 `window keydown` + 一长串 `if`；现在键位在 `keyboard/definitions.ts`，
 * 这里只声明「做什么」并注册 —— 命令由视图挂载注册，所以未打开剪辑窗时这些键位不会被认领。
 *
 * 焦点策略逐键不同（见键位表注释）：`mod+z` / `mod+s` 允许在输入框里生效，空格 / S / Delete 不允许。
 */

import { SHORTCUT_COMMAND } from '@/keyboard/definitions'
import { useCommands } from '@/keyboard/react'
import type { Command } from '@/keyboard/types'
import { useClipchampStore } from '@/stores/clipchamp.ts'

const CLIPCHAMP_COMMANDS: Command[] = [
  {
    id: SHORTCUT_COMMAND.CLIPCHAMP_UNDO,
    title: '剪辑：撤销',
    keywords: 'undo',
    group: '剪辑',
    run: function () {
      useClipchampStore.getState().undo()
    }
  },
  {
    id: SHORTCUT_COMMAND.CLIPCHAMP_REDO,
    title: '剪辑：重做',
    keywords: 'redo',
    group: '剪辑',
    run: function () {
      useClipchampStore.getState().redo()
    }
  },
  {
    id: SHORTCUT_COMMAND.CLIPCHAMP_SAVE,
    title: '剪辑：保存项目',
    keywords: 'save',
    group: '剪辑',
    run: function () {
      useClipchampStore.getState().persistProject()
    }
  },
  {
    id: SHORTCUT_COMMAND.CLIPCHAMP_TOGGLE_PLAY,
    title: '剪辑：播放 / 暂停',
    keywords: 'play pause space',
    group: '剪辑',
    run: function () {
      useClipchampStore.getState().togglePlay()
    }
  },
  {
    id: SHORTCUT_COMMAND.CLIPCHAMP_SPLIT,
    title: '剪辑：在播放头切分',
    keywords: 'split cut',
    group: '剪辑',
    run: function () {
      useClipchampStore.getState().splitAtPlayhead()
    }
  },
  {
    id: SHORTCUT_COMMAND.CLIPCHAMP_REMOVE_SELECTED,
    title: '剪辑：删除选中片段',
    keywords: 'delete remove',
    group: '剪辑',
    run: function () {
      useClipchampStore.getState().removeSelected()
    }
  }
]

/** 退出全屏：只在全屏时注册，用「命令在不在」表达「此刻管不管用」 */
const EXIT_FULLSCREEN_COMMAND: Command = {
  id: SHORTCUT_COMMAND.CLIPCHAMP_EXIT_FULLSCREEN,
  title: '剪辑：退出全屏预览',
  keywords: 'exit fullscreen escape',
  group: '剪辑',
  run: function () {
    useClipchampStore.getState().updateFullscreen(false)
  }
}

function useClipchampCommands(): void {
  const isFullscreen = useClipchampStore(function (state) {
    return state.isFullscreen
  })

  useCommands(
    isFullscreen ? [...CLIPCHAMP_COMMANDS, EXIT_FULLSCREEN_COMMAND] : CLIPCHAMP_COMMANDS
  )
}

export { CLIPCHAMP_COMMANDS, EXIT_FULLSCREEN_COMMAND, useClipchampCommands }
