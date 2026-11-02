import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { DeviceProfile } from '@/features/browser/device'
import { AsideBrowserDevice } from './aside-browser-device'

const IPHONE: DeviceProfile = {
  width: 393,
  height: 852,
  dpr: 3,
  mobile: true,
  userAgent: 'Mozilla/5.0 (iPhone)'
}

function openMenu() {
  fireEvent.click(screen.getByRole('button', { name: /设备模拟/ }))
}

describe('AsideBrowserDevice', function () {
  it('桌面态：菜单列出全部预设，选中后回传档案', async function () {
    const onSelect = vi.fn()
    render(
      <AsideBrowserDevice
        device={null}
        onSelect={onSelect}
      />
    )

    openMenu()
    expect(await screen.findByRole('menu')).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /iPhone 15 Pro/ })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /Pixel 8/ })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('menuitem', { name: /iPhone 15 Pro/ }))
    expect(onSelect).toHaveBeenCalledTimes(1)
    const picked = onSelect.mock.calls[0][0] as DeviceProfile
    expect(picked.width).toBe(393)
    expect(picked.height).toBe(852)
    expect(picked.dpr).toBe(3)
    expect(picked.mobile).toBe(true)
    expect(picked.userAgent).toContain('iPhone')
  })

  it('桌面预设与退出模拟同义：回传 null', async function () {
    const onSelect = vi.fn()
    render(
      <AsideBrowserDevice
        device={IPHONE}
        onSelect={onSelect}
      />
    )
    openMenu()
    fireEvent.click(
      await screen.findByRole('menuitem', {
        name: function (accessibleName) {
          return accessibleName.startsWith('桌面')
        }
      })
    )
    expect(onSelect).toHaveBeenCalledWith(null)
  })

  it('模拟态：能旋转、能退出', async function () {
    const onSelect = vi.fn()
    render(
      <AsideBrowserDevice
        device={IPHONE}
        onSelect={onSelect}
      />
    )
    // 触发按钮在模拟态下换成「切换设备模拟」的语义
    expect(screen.getByRole('button', { name: '切换设备模拟' })).toBeInTheDocument()

    openMenu()
    expect(await screen.findByRole('menu')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('menuitem', { name: /旋转 90°/ }))
    const rotated = onSelect.mock.calls[0][0] as DeviceProfile
    expect(rotated.width).toBe(852)
    expect(rotated.height).toBe(393)

    openMenu()
    fireEvent.click(await screen.findByRole('menuitem', { name: /退出模拟/ }))
    expect(onSelect).toHaveBeenLastCalledWith(null)
  })

  it('自定义宽高：应用后回传自定义档案', async function () {
    const onSelect = vi.fn()
    render(
      <AsideBrowserDevice
        device={null}
        onSelect={onSelect}
      />
    )
    openMenu()
    await screen.findByRole('menu')

    fireEvent.change(screen.getByLabelText('设备宽度'), { target: { value: '320' } })
    fireEvent.change(screen.getByLabelText('设备高度'), { target: { value: '640' } })
    fireEvent.change(screen.getByLabelText('设备像素比'), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: '应用' }))

    await waitFor(function () {
      expect(onSelect).toHaveBeenCalledTimes(1)
    })
    const custom = onSelect.mock.calls[0][0] as DeviceProfile
    expect(custom).toMatchObject({ width: 320, height: 640, dpr: 2, mobile: true })
  })

  it('宽高非法时不回传', async function () {
    const onSelect = vi.fn()
    render(
      <AsideBrowserDevice
        device={null}
        onSelect={onSelect}
      />
    )
    openMenu()
    await screen.findByRole('menu')

    fireEvent.change(screen.getByLabelText('设备宽度'), { target: { value: '0' } })
    fireEvent.click(screen.getByRole('button', { name: '应用' }))

    expect(onSelect).not.toHaveBeenCalled()
  })

  it('disabled 时触发按钮不可点', function () {
    render(
      <AsideBrowserDevice
        device={null}
        disabled
        onSelect={vi.fn()}
      />
    )
    expect(screen.getByRole('button', { name: /设备模拟/ })).toBeDisabled()
  })
})
