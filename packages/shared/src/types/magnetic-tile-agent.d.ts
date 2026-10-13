declare namespace MagneticTile {
  namespace Agent {
    interface Session {
      id: string
      title: string
      pinned: boolean
      providerID: string | null
      workspaceID: string | null
      createdAt: number
      updatedAt: number
    }

    interface Workspace {
      id: string
      title: string
      icon: string
      color: string
      pinned: boolean
      archivedAt: number | null
      createdAt: number
      updatedAt: number
    }

    interface WorkspaceFolder {
      id: string
      workspaceID: string
      path: string
      isPrimary: boolean
      sort: number
      createdAt: number
      updatedAt: number
    }

    interface Message {
      id: string
      identity: Identity
      fragment: string
      /** 上一条消息（assistant-ui 的线程分支靠它串起来）；首条为 null */
      parentID: string | null
      /** 内容格式：`ith/thread-message-like` 等（与 `packages/chat` 的 `LOCAL_FORMAT` 同源） */
      format: string
      thinking: string | null
      parts: string | null
      sessionID: string
      createdAt: number
      updatedAt: number
    }

    /** 一次模型运行的用量（客户端侧账本；服务端另有网关口径，两者分开算） */
    interface Usage {
      id: string
      /** 运行 id：同一次运行重复写入要能认出是同一条 */
      runID: string
      sessionID: string
      providerID: string | null
      model: string
      inputTokens: number
      outputTokens: number
      totalTokens: number
      createdAt: number
    }

    namespace Communicate {
      interface Params {
        model: Model
        raw?: boolean
        stream?: boolean
        messages: Message[]
      }

      type Identity = 'system' | 'assistant' | 'user' | 'tool'

      type Model = 'qwen3:8b' | 'deepseek-r1:8b'

      interface Message {
        role: Identity
        content: string
        thinking?: string
      }

      interface Response {
        model: Model
        created_at: string
        message: Message
        done: boolean
        done_reason?: string
        total_duration?: number
        load_duration?: number
        prompt_eval_count?: number
        prompt_eval_duration?: number
        eval_count?: number
        eval_duration?: number
      }
    }
  }
}
