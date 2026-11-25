/**
 * `agentd.db` 的打开与自检。
 *
 * 这里守的是打包场景的那次事故：`MIGRATIONS` 只有一版，改动 v1 脚本后旧库的
 * `_migrations` 里已经记了 version 1，迁移整份跳过 —— 于是 agentd 在就绪前因为
 * `no such table: gate_requests` 退出，客户端只看到「agentd 启动失败」。
 */
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'

import { openDb } from './db'

let dirs: string[] = []

function makeDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'agentd-db-'))
  dirs.push(dir)
  return dir
}

afterEach(function () {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  dirs = []
})

describe('openDb', function () {
  it('全新库：按当前脚本建好全部对象，不做隔离', function () {
    const dir = makeDir()
    const file = join(dir, 'agentd.db')
    const db = openDb(file)
    try {
      for (const table of ['thread_identity', 'run_events', 'gate_requests', 'lg_checkpoints']) {
        expect(
          db.get("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", table)
        ).toBeTruthy()
      }
      expect(
        readdirSync(dir).filter(function (name) {
          return name.includes('.stale-')
        })
      ).toEqual([])
    } finally {
      db.close()
    }
  })

  it('旧脚本建的库缺表时：隔离留档并重建', function () {
    const dir = makeDir()
    const file = join(dir, 'agentd.db')

    // 模拟「加 gate_requests 之前」的库：v1 已记账，但表少了几张、还留着旧数据
    const old = new DatabaseSync(file)
    old.exec('CREATE TABLE _migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);')
    old.exec("INSERT INTO _migrations (version, applied_at) VALUES (1, '2026-01-01T00:00:00.000Z');")
    old.exec(
      'CREATE TABLE thread_identity (thread_id TEXT PRIMARY KEY, acp_session_id TEXT NOT NULL,' +
        ' graph_thread_id TEXT NOT NULL, last_run_id TEXT, updated_at TEXT NOT NULL);'
    )
    old.exec(
      "INSERT INTO thread_identity VALUES ('t-old', 's-old', 'g-old', NULL, '2026-01-01T00:00:00.000Z');"
    )
    old.close()

    const db = openDb(file)
    try {
      // 缺的表补上了（说明走的是「整份重建」，不是只建缺的那张）
      expect(
        db.get("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'gate_requests'")
      ).toBeTruthy()
      // 旧库是**隔离**而不是合并：旧行不该出现在新库里
      expect(db.get('SELECT COUNT(*) AS n FROM thread_identity')).toEqual({ n: 0 })
      // 留档文件在同目录，命名带 `.stale-`
      const stale = readdirSync(dir).filter(function (name) {
        return name.includes('.stale-')
      })
      expect(stale.length).toBeGreaterThan(0)
    } finally {
      db.close()
    }
  })

  it('同一份库重复打开不会反复隔离', function () {
    const dir = makeDir()
    const file = join(dir, 'agentd.db')
    openDb(file).close()
    openDb(file).close()
    const stale = readdirSync(dir).filter(function (name) {
      return name.includes('.stale-')
    })
    expect(stale).toEqual([])
  })
})
