import { notify } from '@/features/shell/notice-state.ts'

import { insertNavigation, type InsertResult } from './insert.ts'
import { canPin, clipTitle } from './pin.ts'

const RESULT_TEXT: Record<InsertResult, string> = {
  added: '已固定到新标签',
  duplicate: '墙上已经有这个链接',
  missing: '还没有墙面，稍后再试'
}

/** 弹窗和侧栏把当前页挂到墙上，并在页面里提示结果 */
export async function pinSite(url: string | undefined, title: string): Promise<void> {
  if (!canPin(url)) {
    notify('这个页面不能固定')
    return
  }

  try {
    const result = await insertNavigation(
      {
        title: clipTitle(title, url),
        url,
        size: 2,
        shape: 'square',
        direction: 'horizontal'
      },
      { skipSameUrl: true }
    )
    notify(RESULT_TEXT[result])
  } catch (error) {
    console.error('[pin] 固定失败', error)
    notify('没有固定成功')
  }
}
