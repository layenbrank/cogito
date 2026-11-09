/**
 * 编辑器内核之外的贡献，`monaco-editor/editor/editor.api` 入口**不自带**，必须显式引入。
 *
 * `editor.main` 会一次性注册 ~70 个 `editor/contrib/*`（补全、悬停、折叠、右键菜单…），
 * 但那也意味着 ~60 种 basic-language 与 `monaco-lsp-client` 一起进包 —— 代码页性能治理
 * 把入口瘦成 `editor.api` 之后，这些能力就得在这里按「体验分组」显式补回来：
 *
 * - **基础编辑**：光标 / 选区 / 剪贴板 / 右键菜单 / 注释 / 折叠 / 括号匹配 / 单词高亮
 * - **智能特性**：补全、悬停、快速修复、重命名、参数提示、语义高亮、粘贴预览…
 * - **语言服务**：TS / JSON 的 `monaco.contribution`（诊断、补全、悬停的数据源）
 *
 * 关键在于**时机**：这些模块都是副作用注册，必须赶在「创建编辑器」和「创建带该
 * languageId 的 model」之前。monaco 有三处「一次性」行为，晚到的注册不会回放：
 *
 * 1. `registerEditorContribution` 只是往注册表里加一条，`editor.create` 时快照一次；
 *    之后注册的贡献不会挂到已经存在的 editor 上 —— `editor.getAction('actions.find')`
 *    恒为 null，Ctrl+F 静默失效。
 * 2. `LanguageService.requestRichLanguageFeatures` 用 Set 记住「已请求过」的语言，
 *    `languages.onLanguage` / `onLanguageEncountered` 也都是一次性监听。model 先带着
 *    `typescript` 出现、语言服务后加载，就再也不会触发 `setupTypeScript`（没有诊断）。
 * 3. `TokenizationRegistry.getOrCreate` 只解析调用那一刻已注册的 tokenizer 工厂。
 *
 * 所以代码窗（`views/code/workspace/monaco-host.tsx`）静态引入本模块，赶在首个 editor
 * 创建之前；懒加载入口统一走 `lib/monaco-loader.ts` 的 `importMonaco()`，它也会先等这里完成。
 *
 * 分包：这些模块都在 `node_modules/monaco-editor` 下，随 `vendor-monaco` 一起走，
 * 不会回到首屏（见 `vite.chunk.ts`）。
 */

/* ── 基础编辑 ──────────────────────────────────────────────────────────── */
// 核心命令（光标移动 / 删除 / 撤销）与编辑器组件本体
import 'monaco-editor/editor/browser/widget/codeEditor/codeEditorWidget'
import 'monaco-editor/editor/browser/coreCommands'
import 'monaco-editor/editor/contrib/bracketMatching/browser/bracketMatching'
import 'monaco-editor/editor/contrib/caretOperations/browser/caretOperations'
import 'monaco-editor/editor/contrib/caretOperations/browser/transpose'
import 'monaco-editor/editor/contrib/clipboard/browser/clipboard'
import 'monaco-editor/editor/contrib/comment/browser/comment'
import 'monaco-editor/editor/contrib/contextmenu/browser/contextmenu'
import 'monaco-editor/editor/contrib/cursorUndo/browser/cursorUndo'
import 'monaco-editor/editor/contrib/dnd/browser/dnd'
import 'monaco-editor/editor/contrib/dropOrPasteInto/browser/copyPasteContribution'
import 'monaco-editor/editor/contrib/dropOrPasteInto/browser/dropIntoEditorContribution'
import 'monaco-editor/editor/contrib/floatingMenu/browser/floatingMenu.contribution'
import 'monaco-editor/editor/contrib/folding/browser/folding'
import 'monaco-editor/editor/contrib/fontZoom/browser/fontZoom'
import 'monaco-editor/editor/contrib/indentation/browser/indentation'
import 'monaco-editor/editor/contrib/insertFinalNewLine/browser/insertFinalNewLine'
import 'monaco-editor/editor/contrib/lineSelection/browser/lineSelection'
import 'monaco-editor/editor/contrib/linesOperations/browser/linesOperations'
import 'monaco-editor/editor/contrib/linkedEditing/browser/linkedEditing'
import 'monaco-editor/editor/contrib/links/browser/links'
import 'monaco-editor/editor/contrib/longLinesHelper/browser/longLinesHelper'
import 'monaco-editor/editor/contrib/middleScroll/browser/middleScroll.contribution'
import 'monaco-editor/editor/contrib/multicursor/browser/multicursor'
import 'monaco-editor/editor/contrib/placeholderText/browser/placeholderText.contribution'
import 'monaco-editor/editor/contrib/readOnlyMessage/browser/contribution'
import 'monaco-editor/editor/contrib/sectionHeaders/browser/sectionHeaders'
import 'monaco-editor/editor/contrib/smartSelect/browser/smartSelect'
import 'monaco-editor/editor/contrib/snippet/browser/snippetController2'
import 'monaco-editor/editor/contrib/toggleTabFocusMode/browser/toggleTabFocusMode'
import 'monaco-editor/editor/contrib/unusualLineTerminators/browser/unusualLineTerminators'
import 'monaco-editor/editor/contrib/wordHighlighter/browser/wordHighlighter'
import 'monaco-editor/editor/contrib/wordOperations/browser/wordOperations'
import 'monaco-editor/editor/contrib/wordPartOperations/browser/wordPartOperations'

/* ── 智能特性 ──────────────────────────────────────────────────────────── */
import 'monaco-editor/editor/contrib/codeAction/browser/codeActionContributions'
import 'monaco-editor/editor/contrib/codelens/browser/codelensController'
import 'monaco-editor/editor/contrib/colorPicker/browser/colorPickerContribution'
import 'monaco-editor/editor/contrib/documentSymbols/browser/documentSymbols'
import 'monaco-editor/editor/contrib/find/browser/findController'
import 'monaco-editor/editor/contrib/format/browser/formatActions'
import 'monaco-editor/editor/contrib/gotoError/browser/gotoError'
import 'monaco-editor/editor/contrib/gotoError/browser/markerSelectionStatus'
import 'monaco-editor/editor/contrib/gotoSymbol/browser/goToCommands'
import 'monaco-editor/editor/contrib/gotoSymbol/browser/link/goToDefinitionAtPosition'
import 'monaco-editor/editor/contrib/hover/browser/hoverContribution'
import 'monaco-editor/editor/contrib/inlayHints/browser/inlayHintsContribution'
import 'monaco-editor/editor/contrib/inlineCompletions/browser/inlineCompletions.contribution'
import 'monaco-editor/editor/contrib/inlineProgress/browser/inlineProgress'
import 'monaco-editor/editor/contrib/inPlaceReplace/browser/inPlaceReplace'
import 'monaco-editor/editor/contrib/parameterHints/browser/parameterHints'
import 'monaco-editor/editor/contrib/rename/browser/rename'
import 'monaco-editor/editor/contrib/semanticTokens/browser/documentSemanticTokens'
import 'monaco-editor/editor/contrib/semanticTokens/browser/viewportSemanticTokens'
import 'monaco-editor/editor/contrib/stickyScroll/browser/stickyScrollContribution'
import 'monaco-editor/editor/contrib/suggest/browser/suggestController'
import 'monaco-editor/editor/contrib/suggest/browser/suggestInlineCompletions'
import 'monaco-editor/editor/contrib/tokenization/browser/tokenization'
import 'monaco-editor/editor/standalone/browser/quickAccess/standaloneGotoLineQuickAccess'
import 'monaco-editor/editor/standalone/browser/quickAccess/standaloneGotoSymbolQuickAccess'
import 'monaco-editor/editor/standalone/browser/referenceSearch/standaloneReferenceSearch'

/* ── diff 编辑器（代码窗的变更视图同样吃这些动作） ─────────────────────── */
import 'monaco-editor/editor/browser/widget/diffEditor/diffEditor.contribution'
import 'monaco-editor/editor/contrib/diffEditorBreadcrumbs/browser/contribution'

/* ── 语言服务（TS / JSON 诊断、补全、悬停的数据源） ────────────────────── */
import 'monaco-editor/language/typescript/monaco.contribution'
import 'monaco-editor/language/json/monaco.contribution'

/*
 * 浮层样式（suggest / hover / peek / quick input / 右键菜单…）的设计 token 对齐。
 * 放在贡献之后：monaco 自带 `media/*.css` 由上面的 import 顺带注入，我们的覆盖
 * 同权重时靠「后写」生效（`styles/monaco-widgets.css` 文件头有说明）。
 */
import '@/views/code/styles/monaco-widgets.css'

export {}
