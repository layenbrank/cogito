import type { Rolldown } from 'vite'

type CodeSplitting = Rolldown.CodeSplittingGroup

/**
 * 分包分组：Vue→React 重写后应用只剩「概览 + 导航磁贴」，原来的长表（vue / antd / markdown /
 * ffmpeg / 各类工具库…）已全部失效，这里只留下真正需要区分的几组。
 */
export const chunks: CodeSplitting[] = [
  {
    name: 'core-assets',
    priority: 90,
    test(id) {
      return /[\\/]src[\\/]assets[\\/]/.test(id)
    }
  },
  {
    name: 'core-database',
    priority: 90,
    test(id) {
      return /[\\/]src[\\/]database[\\/]/.test(id)
    }
  },
  {
    name: 'core-features',
    priority: 80,
    test(id) {
      // service worker 会引用镜像写入；不要和带 React 的 feature 打进同一个包
      if (/[\\/]features[\\/]mirror[\\/]/.test(id)) return false
      if (/[\\/]features[\\/]magnetic-tile[\\/]mark\./.test(id)) return false
      return /[\\/]src[\\/]features[\\/]/.test(id)
    }
  },
  {
    name: 'core-views',
    priority: 80,
    test(id) {
      return /[\\/]src[\\/]views[\\/]/.test(id)
    }
  },
  {
    name: 'react',
    priority: 50,
    test(id) {
      return /[\\/]node_modules[\\/](react|react-dom|scheduler|react-router|react-router-dom)[\\/]/.test(
        id
      )
    }
  },
  {
    name: 'utils',
    priority: 40,
    test(id) {
      // dexie 同时被 service worker 和页面用，单独成包，避免把 iconify 拖进后台
      if (/[\\/]node_modules[\\/]dexie[\\/]/.test(id)) return false
      return /[\\/]node_modules[\\/](zod|clsx|@iconify|@tanstack)[\\/]/.test(id)
    }
  }
]
