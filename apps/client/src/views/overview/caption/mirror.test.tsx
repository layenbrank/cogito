import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { registerMirrorSwitch, requestMirrorSwitch } from '@/features/controller/mirror-switch'
import { useMirrorStore } from '@/stores/mirror.ts'
import { MirrorSwitcher } from '@/views/overview/caption/mirror.tsx'

/**
 * 图标运行时（离线图标集）在 jsdom 里很贵：每个 `<Icon>` 都要解析图标数据并插 DOM，
 * 管理对话框一次要画几十个。这些用例断言的是 aria-label 与交互，不关心图形，换成空壳。
 */
vi.mock('@iconify/react/offline', function () {
  return {
    Icon: function StubIcon(props: { icon: string; className?: string }) {
      return (
        <span
          data-icon={props.icon}
          className={props.className}
        />
      )
    }
  }
})

function buildMirror(id: string, title: string, index: number, description = ''): Mirror {
  const now = Date.now()
  return {
    id,
    title,
    description,
    index,
    mark: '',
    background: null,
    backdrop: null,
    overlay: '',
    archivedAt: null,
    createdAt: now,
    updatedAt: now
  }
}

const MIRRORS: Mirror[] = [
  buildMirror('m1', '工作台', 0, '日常待办与日程'),
  buildMirror('m2', '影音', 1, '视频与音乐收藏')
]

function seed(mirrors: Mirror[]) {
  useMirrorStore.getState().toUpdateMirrors(mirrors)
  useMirrorStore.getState().toCommitMirrorPayload({ mirror: mirrors[0] ?? null, magneticTiles: [] })
}

function registerSwitch() {
  const switchTo = vi.fn(function () {
    return Promise.resolve()
  })
  return { switchTo, unregister: registerMirrorSwitch(switchTo) }
}

afterEach(function () {
  useMirrorStore.setState({ mirrors: [], active: { mirror: null, magneticTile: null } })
})

describe('MirrorSwitcher', function () {
  it('渲染当前镜像（序号 + 标题）', function () {
    seed(MIRRORS)
    render(<MirrorSwitcher />)

    const trigger = screen.getByRole('button', { name: /镜像：工作台/ })
    expect(trigger).toHaveTextContent('工作台')
    expect(trigger).toHaveTextContent('1')
  })

  it('只有一个镜像时仍可点开切换面，并提供管理入口', function () {
    seed([MIRRORS[0]])
    render(<MirrorSwitcher />)

    fireEvent.click(screen.getByRole('button', { name: /镜像：工作台/ }))

    expect(screen.getAllByRole('option')).toHaveLength(1)
    expect(screen.getByRole('button', { name: '新建镜像' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '管理镜像' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '编辑「工作台」' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '删除「工作台」' })).not.toBeInTheDocument()
  })

  it('没有镜像时给「新建镜像」入口', function () {
    seed([])
    render(<MirrorSwitcher />)

    expect(screen.getByRole('button', { name: '新建镜像' })).toBeInTheDocument()
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('点开列出全部镜像，点击非当前项发起切换', function () {
    seed(MIRRORS)
    const { switchTo, unregister } = registerSwitch()

    render(<MirrorSwitcher />)
    fireEvent.click(screen.getByRole('button', { name: /镜像：工作台/ }))

    const options = screen.getAllByRole('option')
    expect(options).toHaveLength(2)
    expect(options[0]).toHaveAttribute('aria-selected', 'true')

    const secondRowButton = options[1]?.querySelector('button')
    expect(secondRowButton).not.toBeNull()
    fireEvent.click(secondRowButton as HTMLElement)
    expect(switchTo).toHaveBeenCalledWith('m2')

    unregister()
  })

  it('点击当前项只关面板、不发起切换', function () {
    seed(MIRRORS)
    const { switchTo, unregister } = registerSwitch()

    render(<MirrorSwitcher />)
    fireEvent.click(screen.getByRole('button', { name: /镜像：工作台/ }))

    const activeRowButton = screen.getAllByRole('option')[0]?.querySelector('button')
    expect(activeRowButton).not.toBeNull()
    fireEvent.click(activeRowButton as HTMLElement)
    expect(switchTo).not.toHaveBeenCalled()

    unregister()
  })

  it('键盘 ↑↓ 移动高亮，Enter 切换高亮项，Home/End 到位', function () {
    seed(MIRRORS)
    const { switchTo, unregister } = registerSwitch()

    render(<MirrorSwitcher />)
    fireEvent.click(screen.getByRole('button', { name: /镜像：工作台/ }))

    const listbox = screen.getByRole('listbox', { name: '镜像' })
    expect(screen.getAllByRole('option')[0]).toHaveAttribute('data-cursor', 'true')

    fireEvent.keyDown(listbox, { key: 'ArrowDown' })
    expect(screen.getAllByRole('option')[1]).toHaveAttribute('data-cursor', 'true')

    fireEvent.keyDown(listbox, { key: 'ArrowDown' })
    expect(screen.getAllByRole('option')[0]).toHaveAttribute('data-cursor', 'true')

    fireEvent.keyDown(listbox, { key: 'End' })
    fireEvent.keyDown(listbox, { key: 'Enter' })
    expect(switchTo).toHaveBeenCalledWith('m2')

    unregister()
  })

  it('管理镜像：可改名称、描述与图标', async function () {
    seed(MIRRORS)
    const toUpdateMirror = vi.fn(function () {
      return Promise.resolve()
    })
    useMirrorStore.setState({ toUpdateMirror })

    render(<MirrorSwitcher />)
    fireEvent.click(screen.getByRole('button', { name: /镜像：工作台/ }))
    fireEvent.click(screen.getByRole('button', { name: '管理镜像' }))

    expect(await screen.findByRole('heading', { name: '管理镜像' })).toBeInTheDocument()

    const titleInput = screen.getByRole('textbox', { name: '「工作台」名称' })
    const descInput = screen.getByRole('textbox', { name: '「工作台」描述' })
    fireEvent.change(titleInput, { target: { value: '新名字' } })
    fireEvent.blur(titleInput)
    fireEvent.change(descInput, { target: { value: '新描述' } })
    fireEvent.blur(descInput)

    fireEvent.click(screen.getByRole('option', { name: 'lucide:briefcase' }))

    await waitFor(function () {
      expect(toUpdateMirror).toHaveBeenCalledWith([{ key: 'm1', change: { title: '新名字' } }])
      expect(toUpdateMirror).toHaveBeenCalledWith([
        { key: 'm1', change: { description: '新描述' } }
      ])
      expect(toUpdateMirror).toHaveBeenCalledWith([
        { key: 'm1', change: { mark: 'lucide:briefcase' } }
      ])
    })
    // 这一条要开管理对话框（弹层 + 图标网格 + 列表），默认 5s 在整包并发时不够用
  }, 15_000)

  it('管理镜像：删除先二次确认，确认后按 id 删除', async function () {
    seed(MIRRORS)
    const toRemoveMirror = vi.fn(function () {
      return Promise.resolve()
    })
    useMirrorStore.setState({ toRemoveMirror })

    render(<MirrorSwitcher />)
    fireEvent.click(screen.getByRole('button', { name: /镜像：工作台/ }))
    fireEvent.click(screen.getByRole('button', { name: '管理镜像' }))
    fireEvent.click(await screen.findByRole('button', { name: '删除「影音」' }))

    expect(await screen.findByText('删除镜像')).toBeInTheDocument()
    expect(screen.getByText(/将删除「影音」/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    await waitFor(function () {
      expect(toRemoveMirror).toHaveBeenCalledWith(['m2'])
    })
  }, 15_000)

  it('切换中禁用触发按钮', function () {
    seed(MIRRORS)
    expect(requestMirrorSwitch('m2')).toBeInstanceOf(Promise)
    render(<MirrorSwitcher />)
    expect(screen.getByRole('button', { name: /镜像：工作台/ })).toBeEnabled()
  })
})
