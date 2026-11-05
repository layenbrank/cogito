# composer chip 线格式（`@` 方案）与破坏性变更说明

面向：改 composer / prompts / 历史消息渲染的同学，以及写发布说明的人。

## 结论

composer 的 chip 线格式从 assistant-ui 的 directive 换成了 Cursor 风格的 `@<id>`。
**这是一次不兼容变更**：`parseDocument` 只认 `@`，不再解析 `:type[label]{name=id}`。
本轮按约定**不做兼容性代码** —— 没有 directive 解析分支、没有历史数据改写脚本。

## 线格式

| chip 类型 | 线格式 | 例子 |
| --- | --- | --- |
| 文件 / 文件夹 | `@<id>`，id 就是引用路径（分隔符统一 `/`） | `@apps/client/src/views/agent/chat/chat.tsx` |
| 含空白的路径 | `@"<id>"`，内部 `"` → `\"` | `@"apps/my dir/a.ts"` |
| 浏览器标签页 | `@browser-<uuid>`（完整 UUID 正则校验，避免把 `browser-2/a.ts` 当 chip） | `@browser-fc893ce2-4290-416f-b07b-78ae4a992e40` |
| 技能 | `@skill:<name>` | `@skill:dingtalk-aitable` |
| 旧 directive | **不再识别**，按普通文本显示 | `:browser[页面标题]{name=browser-2}` |

- 往返恒等：`serialize(buildChip(type, label, id)) === '@' + (需要引号 ? '"' + id + '"' : id)`。
- label 不进线格式，解析时由 `deriveChipLabel(type, id)` 派生：file / browser 取 id，skill 去掉 `skill:`。
- type 也不进线格式，由 id 形态反推：`skill:` 前缀 → skill；`browser-<uuid>` → browser；其余 → file。
- 「光标 offset = 序列化文本长度」这条不变式没有变，`locateOffset / sliceAtoms / replaceRange` 都按文本长度算。

## 什么样的 `@` 才算 chip

两道闸，任一不过就按普通文本处理（这样 `user@example.com`、`@Component()`、`@media` 都不会变 chip）：

1. `@` 必须落在 token 边界：行首、空白，或 `（(【[「『"'‘“，,、；;：:！!？?` 和中文。
2. id 形态要像引用：含 `/`、匹配 `browser-<uuid>`、或以 `skill:` 开头。
3. 未加引号的 id 在空白与常见中英文标点处结束 —— 这样「@apps/a.ts，然后」不会把逗号并进 id。

误判的代价可控：线格式文本恒等，模型看到的内容不会变，只是视觉上多了一个 chip 外观。

## 消费端清单

- 写出点：`packages/design/src/assistant/composer-document.ts`（`serializeDocument`）；解析点同一文件的 `parseDocument`。
- 视图：`composer-input.aui.tsx`（两段式 chip：目录段可截断、末段完整）、`composer-chip-text.tsx`（历史消息里的 chip，支持注入 `resolveLabel` 查浏览器页标题）。
- 键位：Backspace 走 `findAtomEndingAt`、Delete 走 `findAtomStartingAt`，命中 chip 整块删；Enter 不再做删除（历史上 Enter 误用了 Backspace 的逻辑，导致「@ 选完按回车 = 删 chip 且不发送」）。
- 剪贴板：`copy` 额外写私有 MIME `application/x-cogito-composer`（atoms 的 JSON），`paste` 优先读它，读不到才退回 `parseDocument(plain)` —— 这样「复制到记事本再粘回」会退化成 `@path` 文本，仍能被识别。
- 给模型的说明：`apps/client/src/features/agent/model/prompts.ts` 里的浏览器引用说明必须与线格式一致（`@browser-<uuid>`，去掉前导 `@` 就是 tab 参数）。

## 发布说明要写的话

> composer 的引用（chip）改用 `@路径` / `@browser-<uuid>` / `@skill:<name>` 写法。
> 历史会话里的旧写法 `:file[...]{name=...}` 会显示为普通文本，内容不丢、但不再有 chip 外观与悬浮提示。
> 这是有意的破坏性变更，没有做自动迁移。
