/**
 * 代码窗 Caption 中列（shell center）：搜索胶囊。
 *
 * 三列 grid 让标题、布局控件各占一列，中列中心恒等于窗口中心 ——
 * 不再靠 `mx-auto` 在 begin 里近似居中（会被右侧控件宽度带偏）。
 */
import { SearchPill } from '@/views/code/caption/search-pill.tsx'

function CodeCaptionCenter() {
  return <SearchPill />
}

export { CodeCaptionCenter }
