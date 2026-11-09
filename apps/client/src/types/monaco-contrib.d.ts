/**
 * monaco-editor 的 contrib 入口没有随包提供类型声明（只在 `esm/vs/editor/api` 里
 * 有 `monaco.d.ts`）。这些入口只做副作用注册（查找框、格式化动作），调用方不取
 * 返回值，声明成 `unknown` 即可。
 *
 * 注意：模块路径是 monaco-editor 的 `editor/*` 别名（见 vite 配置的 alias），
 * 不是 `esm/vs/editor/*`。
 */
declare module 'monaco-editor/editor/contrib/find/browser/findController'
declare module 'monaco-editor/editor/contrib/format/browser/formatActions'
