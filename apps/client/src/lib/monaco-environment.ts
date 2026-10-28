/**
 * Monaco worker 装配。
 *
 * 必须静态挂载（悬停、诊断、补全都依赖同一个实例），且全应用只能有一份：
 * 视图各自写 `self.MonacoEnvironment` 会互相覆盖 —— 后加载的视图若只映射
 * editor worker，代码窗的 JSON / TS 语言服务会静默失效。
 */
import editorWorker from 'monaco-editor/editor/editor.worker?worker'
import cssWorker from 'monaco-editor/language/css/css.worker?worker'
import htmlWorker from 'monaco-editor/language/html/html.worker?worker'
import jsonWorker from 'monaco-editor/language/json/json.worker?worker'
import tsWorker from 'monaco-editor/language/typescript/ts.worker?worker'

self.MonacoEnvironment = {
  getWorker(_: unknown, label: string): Worker {
    if (label === 'json') return new jsonWorker()
    if (label === 'css' || label === 'scss' || label === 'less') return new cssWorker()
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new htmlWorker()
    if (label === 'typescript' || label === 'javascript') return new tsWorker()
    return new editorWorker()
  }
}
