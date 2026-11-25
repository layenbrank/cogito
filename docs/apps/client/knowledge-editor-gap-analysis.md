# 空间编辑器：能力对照与差距清单

> 目的：把「我们用起来还缺什么」从印象变成清单。对照 Obsidian / Typora / 语雀 / 石墨的功能面，
> 只保留与我们主线（**读 agent 产出 + 自己动手写 wiki**）有关的项，并给出落点与成本。
> 相关决策：`docs/decisions/knowledge-wiki-editor-first.md`（D12/D13 编辑器优先、D31 渲染预算、D32 wikilink、D33 本文、D34 callout）。

## 结论摘要

- 编辑器主干（Markdown 双向、GFM、表格、代码高亮、数学、Mermaid、图片、三视图、查找替换、大纲、
  出链/反链/断链、导出）已经齐了，缺的不是「输入能力」而是**页面之间的组织与检索**。
- 差距最大的三块，按对我们主线的价值排序：
  1. **链接体验**（`[[` 补全 / 点击跳转 / 缺失页创建）——规范里页面靠 `[[标题]]` 互链，这块断了等于图谱靠手打；**本轮已补**；
  2. **多文档并行**（多标签页 / 分屏）——现在是「一次只看一篇」，来回切会把上下文挤掉；
  3. **标签**（`#tag` 与 frontmatter `tags` 的合并视图）——语雀/石墨把它当第二套导航，我们只有只读展示。
- 本轮已补：wikilink 全链路（D32）、callout（D34）、命令面板全库检索、外链点击打开。

## 对照表

`✅` 已具备 · `🟡` 部分 · `—` 无

| 能力 | Obsidian | Typora | 语雀 | 石墨 | 我们 | 备注 |
| --- | --- | --- | --- | --- | --- | --- |
| Markdown 双向（WYSIWYG ↔ 源） | 🟡（源码模式） | ✅ | —（富文本） | — | ✅ | 实时 / 源码 / 分屏三视图 |
| GFM（表格、任务、删除线） | ✅ | ✅ | ✅ | 🟡 | ✅ | |
| 代码块高亮 + 语言 | ✅ | ✅ | ✅ | 🟡 | ✅ | lowlight |
| 数学（行内 + 块） | ✅ | ✅ | 🟡 | — | ✅ | KaTeX |
| Mermaid | ✅（插件） | 🟡 | ✅（画板） | — | ✅ | |
| 图片上传 / 拖拽 / 粘贴 | ✅ | ✅ | ✅ | ✅ | ✅ | 粘贴即落 `assets/` |
| 大纲面板 | ✅ | ✅ | ✅ | ✅ | ✅ | 右栏 |
| 出链 / 反链 | ✅ | — | 🟡（引用） | — | ✅ | `page-links.ts`，含断链 |
| 全文搜索 | ✅ | 🟡 | ✅ | ✅ | ✅ | 侧栏 FTS（后端）+ 命令面板 |
| **`[[` 自动补全** | ✅ | — | —（@提及） | — | ✅ | 本轮（D32） |
| **wikilink 点击跳转** | ✅ | — | — | — | ✅ | 本轮（D32） |
| **缺失页一键创建** | ✅ | — | — | — | ✅ | 复用 Page Links |
| **Callout（`> [!note]`）** | ✅ | 🟡（HTML） | ✅（高亮块） | ✅ | ✅ | 本轮（D34） |
| `[[页面#标题]]` 锚点跳转 | ✅ | — | — | — | — | P2，见下 |
| `![[嵌入]]` 页面/图片嵌入 | ✅ | — | 🟡 | — | — | P2 |
| `#tag` 标签 + 标签面板 | ✅ | — | ✅ | 🟡 | 🟡 | frontmatter 只读展示 |
| 文档多标签页 | ✅ | — | ✅ | ✅ | — | P1 |
| 同屏分屏对比 | ✅ | — | 🟡 | 🟡 | 🟡 | 我们有「源码/实时」分屏，不是「两篇对比」 |
| 版本历史 / diff | 🟡（插件/同步） | — | ✅ | ✅ | — | P2，需后端 |
| 标题折叠 | ✅ | ✅ | ✅ | ✅ | — | P2 |
| 目录块 `[toc]` | 🟡（插件） | ✅ | ✅ | ✅ | — | 可以不做：右栏大纲已覆盖 |
| 脚注 | ✅ | ✅ | 🟡 | — | — | P2 |
| 打印 / 导出 PDF | ✅ | ✅ | ✅ | ✅ | 🟡 | 已能导 HTML/zip，PDF 借系统打印 |
| 协同编辑 | 🟡（同步） | — | ✅ | ✅ | — | 明确不做（本地优先） |
| 移动端 | ✅ | — | ✅ | ✅ | 🟡 | `apps/mobile` 另起 |
| 插件生态 | ✅ | — | 🟡 | — | — | 明确不做（模板/工具面替代） |

## P1（下一批就该做）

1. **文档多标签页**：编辑器区顶部一条 tab 条，`openDoc` 追加而不是替换。
   - 价值：读 agent 产出时要在「页 A / 页 B / 待发布」之间来回对照，现在每次切换都丢上下文。
   - 落点：`stores/knowledge.ts` 增加 `openTabs` / `activePath` 的关系，`surface/main-content.tsx` 顶部加 tab 条；
     **未保存草稿必须常驻**（D31 已确立「编辑器不卸载」），tab 只负责切换视图。
   - 成本：中偏大但可控，注意别把 `toCommitEdit` 的落盘路径改成按 tab 分流。
2. **`#tag` 标签 + 标签面板**：正文 `#标签` 与 frontmatter `tags` 合并成一个可点的集合，右栏出「本页标签 / 全库标签」。
   - 落点：`lib/wiki-lint.ts` 已能解析部分结构，标签扫描加在 `stats.ts` 附近；点标签 → 侧栏搜索。
   - 成本：中（要考虑与标题 `#` 的歧义：只认行首或空格后的 `#`）。

## P2（有余力再做）

- `[[页面#标题]]` 锚点跳转：先在 `parseWikiLink` 里保留锚点，跳转后 `scrollIntoView` 到同文 heading。
- `![[页面]]` 嵌入：只读渲染目标页前 N 段，避免编辑态嵌套编辑器。
- 版本历史：需要后端按 revision 存快照（`knowledge_doc.revision` 已有，缺的是历史表与 diff UI）。
- 标题折叠：heading 上加按钮折叠到下一个同级 heading，纯 UI。
- 打印样式：`@media print` + 现有 `exportDocHtml` 复用，产出 A4 友好排版。
- 脚注：`[^1]` 的节点与序列化，成本低但使用频率低。

## 明确不做

- 协同编辑 / 账号体系：本地优先（D5 Rust 为源、SQLite 落盘）。
- 插件市场：能力扩展走**模板 + 工具面**（`cogito_knowledge_*`），不走第三方插件。
- `[toc]` 块：右栏大纲已覆盖同一诉求，再加一个块是重复设计。
- 富文本块级拖拽（语雀卡片）：现有 Markdown 语义已经够用，引入会破坏 `serialize-markdown` 的往返确定性。

## 验证清单（改编辑器相关代码时必须跑）

```powershell
pnpm --filter @cogito/client type-check
pnpm --filter @cogito/client lint
pnpm --filter @cogito/client unit
pnpm --filter @cogito/client build-only
pnpm check:agent-junk
```

Markdown 往返类改动必须带单测（参考 `lib/serialize-markdown.test.ts` 的 wikilink 用例）：
`md → html → md` 后字节级等价，且代码块 / 行内代码 / 表格内不被改写。

## 本轮验证（wikilink + callout）

| 检查 | 结果 |
| --- | --- |
| `pnpm --filter @cogito/client type-check` | 通过 |
| `pnpm --filter @cogito/client lint` | 通过 |
| `pnpm --filter @cogito/client unit` | 1505 passed / 214 files |
| `pnpm --filter @cogito/client build-only` | 成功（仅仓库既有的 `INEFFECTIVE_DYNAMIC_IMPORT` 提示） |
| `pnpm check:agent-junk` | 仓库干净 |
| 新增用例 | `serialize-markdown.test.ts`（wikilink 往返 / 代码内不处理 / callout 往返 / 无标题用默认名 / 普通引用不受影响）、`open-space-doc.test.ts`（标题匹配、锚点与 `.md` 后缀、无活动空间）、`workspace/extensions.test.ts`（schema 往返，抓节点属性/内容约束这类 tsc 抓不到的错） |
| 已知 flake | `features/magnetic-tiles/gallery/preview-cache.test.ts` 在并发满载下偶发 5s 超时，单跑必过；与本次改动无关 |

