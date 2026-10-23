/**
 * MV3 content script 入口（在 `public/manifest.json` 里注册）。
 * 目前没有注入逻辑，保留入口以免 manifest 指向不存在的文件；真正需要时在这里加。
 */
if (import.meta.env.DEV) {
  console.info('[cogito] content script loaded')
}
