import { beforeEach, describe, expect, it, vi } from 'vitest'

const { readDirMock, statMock, readTextFileMock } = vi.hoisted(function () {
  return {
    readDirMock: vi.fn(),
    statMock: vi.fn(),
    readTextFileMock: vi.fn()
  }
})

vi.mock('@tauri-apps/api/path', function () {
  return {
    join: function (...parts: string[]) {
      return Promise.resolve(parts.join('/'))
    }
  }
})

vi.mock('@tauri-apps/plugin-fs', function () {
  return {
    mkdir: vi.fn(),
    writeTextFile: vi.fn(),
    readDir: readDirMock,
    stat: statMock,
    readTextFile: readTextFileMock
  }
})

import {
  buildPlanMarkdown,
  listPlanFiles,
  parsePlanFile,
  readPlanFile
} from '@/features/agent/plan-file'

describe('计划文件', function () {
  beforeEach(function () {
    readDirMock.mockReset()
    statMock.mockReset()
    readTextFileMock.mockReset()
  })

  it('frontmatter 只放总结，不再写 todos 清单', function () {
    const markdown = buildPlanMarkdown({
      title: 'Canvas 预览',
      overview: '抽通用 Konva 壳',
      steps: ['改 a.ts', '跑单测 pnpm unit'],
      body: '# Canvas 预览\n\n## 问题\n老实现不行。\n'
    })
    expect(markdown.startsWith('---\nname: Canvas 预览\noverview: 抽通用 Konva 壳\nisProject: false\n---\n')).toBe(
      true
    )
    // 清单一旦落盘就会被当「任务全集」读取，正文里的细节会被跳过
    expect(markdown).not.toContain('todos:')
    expect(markdown).not.toContain('status: pending')
    // 正文原样写入，正文自带的 H1 不再重复补一个
    expect(markdown).toContain('## 问题\n老实现不行。')
    expect(markdown.match(/# Canvas 预览/g)).toHaveLength(1)
  })

  it('没有正文时退化成编号步骤，且不写空 overview', function () {
    const markdown = buildPlanMarkdown({ title: 'T', overview: '', steps: ['a', 'b'], body: '' })
    expect(markdown).toContain('# T\n\n1. a\n2. b')
    expect(markdown).not.toContain('overview:')
  })

  it('含冒号的标题与总结按 YAML 双引号标量写出', function () {
    const markdown = buildPlanMarkdown({
      title: '计划: 分阶段',
      overview: '',
      steps: [],
      body: 'x'
    })
    expect(markdown).toContain('name: "计划: 分阶段"')
  })

  it('存 → 读：title / overview / 正文逐字还原（生成说明被剥掉）', function () {
    const body = '# 计划: 分阶段\n\n## 实施步骤\n1. 甲\n2. 乙\n'
    const markdown = buildPlanMarkdown({
      title: '计划: 分阶段',
      overview: '抽通用壳',
      steps: [],
      body
    })
    const parsed = parsePlanFile(markdown, 'plan-2026.md')
    expect(parsed.title).toBe('计划: 分阶段')
    expect(parsed.overview).toBe('抽通用壳')
    expect(parsed.body).toBe(body.trim())
    expect(parsed.body).not.toContain('由 cogito 计划模式生成')
  })

  it('frontmatter 缺 name 时回退文件名', function () {
    const parsed = parsePlanFile('## 实施步骤\n1. a\n2. b\n', '旧计划-2026-01-01.md')
    expect(parsed.title).toBe('旧计划-2026-01-01')
    expect(parsed.body).toContain('## 实施步骤')
  })

  it('list 只收 .md 且按 mtime 倒序', async function () {
    readDirMock.mockResolvedValue([
      { name: 'a.md', isFile: true, isDirectory: false },
      { name: 'b.md', isFile: true, isDirectory: false },
      { name: 'note.txt', isFile: true, isDirectory: false },
      { name: 'sub', isFile: false, isDirectory: true }
    ])
    statMock.mockImplementation(function (path: string) {
      const mtime = path.endsWith('a.md')
        ? new Date('2026-01-01T00:00:00Z')
        : new Date('2026-02-01T00:00:00Z')
      return Promise.resolve({ mtime })
    })

    const entries = await listPlanFiles('D:/ws')
    expect(entries.map((entry) => entry.name)).toEqual(['b.md', 'a.md'])
    expect(entries[0].relative).toBe('.cogito/plans/b.md')
    expect(entries[0].modifiedAt).toBeGreaterThan(entries[1].modifiedAt)
  })

  it('计划目录不存在时返回空数组（没保存过不是错误）', async function () {
    readDirMock.mockRejectedValue(new Error('not found'))
    await expect(listPlanFiles('D:/ws')).resolves.toEqual([])
  })

  it('readPlanFile 带上相对路径', async function () {
    readTextFileMock.mockResolvedValue('---\nname: 甲\n---\n# 甲\n\n## 实施步骤\n1. a\n2. b\n')
    const content = await readPlanFile('D:/ws', '.cogito/plans/a.md')
    expect(content.title).toBe('甲')
    expect(content.filePath).toBe('.cogito/plans/a.md')
    expect(readTextFileMock).toHaveBeenCalledWith('D:/ws/.cogito/plans/a.md')
  })
})
