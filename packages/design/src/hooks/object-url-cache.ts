/**
 * `File` → Object URL 的进程级缓存。
 *
 * 为什么不是「每次 effect 新建 + 回收」：缩略图的 `<img src>` 只要有一帧变成空值，
 * 浏览器就会先把图换成 fallback 图标、下一帧再画回来。流式输出时每个 token 都重渲染，
 * 这种「空一帧」就会变成肉眼可见的持续闪烁。
 *
 * 这里的约定：
 * - 同一个 `File`（按身份取，不按内容比）**永远拿到同一串 URL**，渲染期同步可得；
 * - 不按「组件卸载」回收 —— 卸载和重挂载之间没有渲染帧，回收了反而会让下一次重挂载
 *   拿到一串已经失效的 URL（StrictMode 的挂载/卸载/再挂载正好会走到）；
 * - 改成**容量上限 + LRU**：超过上限才回收最久没用的那几串，既不漏也不失稳。
 *
 * 注入 `create` / `revoke` 是为了能在纯函数测试里跑，不依赖 jsdom 的 URL 实现。
 */

interface ObjectUrlCache {
  /** 取这个 File 的 URL；同一 File 幂等，且会把它标成「最近用过」 */
  src(file: File): string
  /** 手动回收全部（测试 / 退出清理用；运行期不调用） */
  dispose(): void
}

/** 64 张缩略图足够覆盖「一屏对话 + composer 里堆着的附件」 */
const DEFAULT_CAPACITY = 64

function createObjectUrlCache(
  create: (file: File) => string = function (file) {
    return URL.createObjectURL(file)
  },
  revoke: (url: string) => void = function (url) {
    URL.revokeObjectURL(url)
  },
  capacity: number = DEFAULT_CAPACITY
): ObjectUrlCache {
  /** 用 Map 而不是 WeakMap：LRU 要能有序淘汰 */
  const urlByFile = new Map<File, string>()

  return {
    src(file) {
      const cached = urlByFile.get(file)
      if (cached !== undefined) {
        // 触碰一次：删掉再插回去，队尾就是「最近用过」
        urlByFile.delete(file)
        urlByFile.set(file, cached)
        return cached
      }

      const url = create(file)
      urlByFile.set(file, url)
      while (urlByFile.size > capacity) {
        const oldest = urlByFile.keys().next()
        if (oldest.done) break
        const stale = urlByFile.get(oldest.value)
        urlByFile.delete(oldest.value)
        if (stale !== undefined) revoke(stale)
      }
      return url
    },
    dispose() {
      for (const url of urlByFile.values()) revoke(url)
      urlByFile.clear()
    }
  }
}

export { createObjectUrlCache, DEFAULT_CAPACITY }
export type { ObjectUrlCache }
