/**
 * 磁贴内对话坞（dock）的类型。
 *
 * 一个 `DockScope` = 一个磁贴/一个域的 AI 入口：它决定「会话是谁的」「系统提示是什么」
 * 「有哪些一键动作」。别的都不管 —— 消息流、审批、停止沿用聊天页那套运行时。
 */

/** 一键动作：点一次就等于发一句话，不需要用户再填输入框 */
interface DockAction {
  id: string
  label: string
  /** lucide 图标名（iconify 离线集） */
  icon?: string
  /**
   * 组装这一轮要说的话（把当前文档/选区/指令一起带上）。
   * 返回 `null` 表示当前上下文不适用（例如没选中文字还点「改写选区」）。
   */
  buildPrompt: () => string | null
}

interface DockScope {
  /** 会话身份：同一 key 复用同一条 ACP 会话，对话不会因为折叠丢失 */
  key: string
  /** 坞头部标题 */
  title: string
  /** 空态提示（这个坞能干什么） */
  hint: string
  /** 每轮追加的系统提示（域 playbook） */
  systemText: string
  /**
   * 一轮跑完后的落点（把结果应用到编辑器/草稿）。
   *
   * 不在这里做「自动应用」：结果先留在对话里，由用户点消息上的按钮才落到文档 ——
   * 与「先建议后应用」一致。
   */
  actions: DockAction[]
}

export type { DockAction, DockScope }
