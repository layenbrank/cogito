/**
 * LangGraph 的 sqlite checkpointer（`node:sqlite`）。
 *
 * ## 为什么自己实现
 *
 * 官方 `@langchain/langgraph-checkpoint-sqlite` 硬依赖 `better-sqlite3`（原生模块），
 * 与本仓「侧车要打成 SEA 单文件、不引原生件」的约束冲突（见 ADR §2.4）。
 * `node:sqlite` 是 Node 24 内置，没有 ABI / 预编译问题。
 *
 * ## 边界
 *
 * 这里只承诺**桌面体验级续接**：进程重启、窗口刷新、断网重连后能接着看同一轮。
 * 跨机可靠执行仍归服务端 duroxide（ADR §2.3）。
 */

import { BaseCheckpointSaver } from '@langchain/langgraph-checkpoint'
import type {
  Checkpoint,
  CheckpointListOptions,
  CheckpointMetadata,
  CheckpointPendingWrite,
  CheckpointTuple,
  PendingWrite,
  SerializerProtocol
} from '@langchain/langgraph-checkpoint'
import type { RunnableConfig } from '@langchain/core/runnables'

import type { AgentdDb } from './db'

type ChannelVersion = number | string
type ChannelVersions = Record<string, ChannelVersion>

interface CheckpointRow {
  checkpoint: Uint8Array
  type: string | null
  metadata: Uint8Array
  parent_checkpoint_id: string | null
}

interface WriteRow {
  task_id: string
  task_path: string
  idx: number
  channel: string
  type: string | null
  value: Uint8Array
}

function readConfigurable(config: unknown): { threadID: string; checkpointNs: string; checkpointID: string | null } {
  const record = (config ?? {}) as { configurable?: Record<string, unknown> }
  const configurable = record.configurable ?? {}
  const threadID = typeof configurable.thread_id === 'string' ? configurable.thread_id : ''
  const checkpointNs =
    typeof configurable.checkpoint_ns === 'string' ? configurable.checkpoint_ns : ''
  const checkpointID =
    typeof configurable.checkpoint_id === 'string' ? configurable.checkpoint_id : null
  return { threadID, checkpointNs, checkpointID }
}

class SqliteSaver extends BaseCheckpointSaver {
  private readonly db: AgentdDb

  constructor(db: AgentdDb, serde?: SerializerProtocol) {
    super(serde)
    this.db = db
  }

  async getTuple(config: unknown): Promise<CheckpointTuple | undefined> {
    const { threadID, checkpointNs, checkpointID } = readConfigurable(config)
    if (!threadID) return undefined

    const row = checkpointID
      ? this.db.get<CheckpointRow>(
          'SELECT checkpoint, type, metadata, parent_checkpoint_id FROM lg_checkpoints WHERE thread_id = ? AND checkpoint_ns = ? AND checkpoint_id = ?',
          threadID,
          checkpointNs,
          checkpointID
        )
      : this.db.get<CheckpointRow>(
          'SELECT checkpoint, type, metadata, parent_checkpoint_id FROM lg_checkpoints WHERE thread_id = ? AND checkpoint_ns = ? ORDER BY checkpoint_id DESC LIMIT 1',
          threadID,
          checkpointNs
        )
    if (!row) return undefined

    const parentCheckpointID = row.parent_checkpoint_id
    const resolvedID = checkpointID ?? ''
    const checkpoint = (await this.serde.loadsTyped(
      row.type ?? 'json',
      row.checkpoint
    )) as Checkpoint
    const metadata = (await this.serde.loadsTyped(
      row.type ?? 'json',
      row.metadata
    )) as CheckpointMetadata
    const id = resolvedID || checkpoint.id

    return {
      config: {
        configurable: {
          thread_id: threadID,
          checkpoint_ns: checkpointNs,
          checkpoint_id: id
        }
      },
      checkpoint,
      metadata,
      parentConfig: parentCheckpointID
        ? {
            configurable: {
              thread_id: threadID,
              checkpoint_ns: checkpointNs,
              checkpoint_id: parentCheckpointID
            }
          }
        : undefined,
      pendingWrites: await this.readWrites(threadID, checkpointNs, id)
    }
  }

  async *list(
    config: unknown,
    options?: CheckpointListOptions
  ): AsyncGenerator<CheckpointTuple> {
    const { threadID, checkpointNs } = readConfigurable(config)
    if (!threadID) return
    const limit = options?.limit ?? 100
    const rows = this.db.all<{ checkpoint_id: string }>(
      'SELECT checkpoint_id FROM lg_checkpoints WHERE thread_id = ? AND checkpoint_ns = ? ORDER BY checkpoint_id DESC LIMIT ?',
      threadID,
      checkpointNs,
      limit
    )
    for (const row of rows) {
      const tuple = await this.getTuple({
        configurable: {
          thread_id: threadID,
          checkpoint_ns: checkpointNs,
          checkpoint_id: row.checkpoint_id
        }
      })
      if (tuple) yield tuple
    }
  }

  async put(
    config: unknown,
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata,
    _newVersions: ChannelVersions
  ): Promise<RunnableConfig> {
    const { threadID, checkpointNs } = readConfigurable(config)
    if (!threadID) throw new Error('checkpoint 缺少 thread_id')
    const [type, checkpointBytes] = await this.serde.dumpsTyped(checkpoint)
    const [, metadataBytes] = await this.serde.dumpsTyped(metadata)
    const parent = readConfigurable(config).checkpointID

    this.db.run(
      `INSERT INTO lg_checkpoints
        (thread_id, checkpoint_ns, checkpoint_id, parent_checkpoint_id, type, checkpoint, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(thread_id, checkpoint_ns, checkpoint_id) DO UPDATE SET
         parent_checkpoint_id = excluded.parent_checkpoint_id,
         type = excluded.type,
         checkpoint = excluded.checkpoint,
         metadata = excluded.metadata`,
      threadID,
      checkpointNs,
      checkpoint.id,
      parent,
      type,
      checkpointBytes,
      metadataBytes,
      new Date().toISOString()
    )

    return {
      configurable: {
        thread_id: threadID,
        checkpoint_ns: checkpointNs,
        checkpoint_id: checkpoint.id
      }
    }
  }

  async putWrites(
    config: unknown,
    writes: PendingWrite[],
    taskId: string,
    taskPath?: string
  ): Promise<void> {
    const { threadID, checkpointNs, checkpointID } = readConfigurable(config)
    if (!threadID || !checkpointID) return
    let index = 0
    for (const write of writes) {
      const [type, value] = await this.serde.dumpsTyped(write[1])
      this.db.run(
        `INSERT INTO lg_writes
          (thread_id, checkpoint_ns, checkpoint_id, task_id, task_path, idx, channel, type, value)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(thread_id, checkpoint_ns, checkpoint_id, task_id, idx) DO UPDATE SET
           channel = excluded.channel,
           type = excluded.type,
           value = excluded.value`,
        threadID,
        checkpointNs,
        checkpointID,
        taskId,
        taskPath ?? '',
        index,
        String(write[0]),
        type,
        value
      )
      index += 1
    }
  }

  async deleteThread(threadId: string): Promise<void> {
    this.db.run('DELETE FROM lg_writes WHERE thread_id = ?', threadId)
    this.db.run('DELETE FROM lg_checkpoints WHERE thread_id = ?', threadId)
  }

  private async readWrites(
    threadID: string,
    checkpointNs: string,
    checkpointID: string
  ): Promise<CheckpointPendingWrite[]> {
    if (!checkpointID) return []
    const rows = this.db.all<WriteRow>(
      'SELECT task_id, task_path, idx, channel, type, value FROM lg_writes WHERE thread_id = ? AND checkpoint_ns = ? AND checkpoint_id = ? ORDER BY task_path, task_id, idx',
      threadID,
      checkpointNs,
      checkpointID
    )
    const writes: CheckpointPendingWrite[] = []
    for (const row of rows) {
      const value = await this.serde.loadsTyped(row.type ?? 'json', row.value)
      writes.push([row.task_id, row.channel, value])
    }
    return writes
  }
}

function createSqliteSaver(db: AgentdDb): SqliteSaver {
  return new SqliteSaver(db)
}

export { SqliteSaver, createSqliteSaver }
