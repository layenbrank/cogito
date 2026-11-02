# 附件缩略图：为什么要自己拿 `<img>`

composer 与用户消息里的图片附件缩略图，走
`packages/design/src/assistant/attachment.aui.tsx` 的 `AttachmentThumb`。
它看起来只是个 56×56 的小方块，但流式输出时曾长期「一直在闪」。两个原因，各修一处。

## 一、`src` 不能有一帧是空的

旧实现用 `Avatar` / `AvatarImage`（base-ui）：它在加载状态不是 `loaded` 时**不渲染**
`<img>`，由 `AvatarFallback` 顶上。而加载状态只要 `src` 变一下就会重置成 `loading`
（`useImageLoadingStatus` 的 effect 依赖 `src`）。所以「src 短暂为空 → 撤图 → 换 URL →
重新解码」这一串，视觉上就是缩略图闪一下；流式输出每个 token 都重渲染，就可能一直闪。

现在 `AttachmentThumb` 自己拿 `<img>`：

- `<img>` 一旦挂上就不因为状态变化被卸掉；
- 只有**真的 `onError`** 才退到文件图标，而且记的是「哪一串 `src` 失败」（`brokenSrc`），
  换图自动复位 —— 不需要在 effect 里 `setState`（那会被 `react-hooks/set-state-in-effect` 拦，
  也确实会多一轮渲染）。

## 二、同一张图必须是同一串 URL

`hooks/use-attachment-src.ts` 不再「每次 effect 里 `createObjectURL` + 回收」，改用
`hooks/object-url-cache.ts` 的进程级缓存：

| 约定                                  | 原因                                                                                |
| ------------------------------------- | ----------------------------------------------------------------------------------- |
| 同一个 `File`（按身份）永远同一串 URL | 换一串就等于让浏览器重新解码一次                                                    |
| 渲染期同步可得                        | 没有「这一帧没有 src」的中间态                                                      |
| 不按组件卸载回收                      | 卸载与重挂载之间没有渲染帧，回收了反而让下一次拿到失效 URL（StrictMode 正好会走到） |
| 容量上限 + LRU（64）                  | 既不漏也不失稳：超过上限才回收最久没用的                                            |

缓存的创建/回收函数可注入，单测在 `packages/design/src/hooks/object-url-cache.test.ts`
（断言「同一 File 只建一次」「淘汰最久未用」「`dispose` 幂等」）。

灯箱（`use-attachment-lightbox-medias.ts`）另有一套按 `id|name|内容|file 身份` 的
fingerprint 复用，那里是「一次预览一张图」，不需要容量上限。

## 三、顺带收紧的一处每 token 重渲染

`views/agent/chat/chat.tsx` 外层订阅了整份 `messages`（`usePlanAutoOpen` 找最新计划），
流式输出时每个 token 都会重渲染。以前 `<Thread components={...}>` 是内联元素，
于是整条消息列表 + composer 跟着每 token 重画一遍；现在元素本身 `useMemo` 住
（依赖只有触发器快照和粘贴回调），重渲染止步在布局这一层。
