import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { openSite } from '@/features/shell/open-site.ts'

import { NavigationTile } from './navigation'

vi.mock('@/features/shell/open-site.ts', function () {
  return { openSite: vi.fn() }
})

function buildTile(overrides: Partial<MagneticTile> = {}): MagneticTile {
  return {
    id: 'tile',
    index: 0,
    title: 'GitHub',
    url: 'https://github.com',
    round: '16px',
    mark: null,
    size: 2,
    shape: 'square',
    direction: 'horizontal',
    mirrorID: 'mirror',
    updatedAt: 0,
    createdAt: 0,
    textColor: '#ffffff',
    component: 'navigation',
    description: '',
    collectionID: null,
    downloadCount: 0,
    background: null,
    backdrop: null,
    archivedAt: null,
    ...overrides
  }
}

function renderTile(tile: MagneticTile) {
  return render(
    <NavigationTile
      tile={tile}
      onEdit={vi.fn()}
      onRemove={vi.fn()}
    />
  )
}

describe('NavigationTile', function () {
  beforeEach(function () {
    vi.clearAllMocks()
  })

  it('没有图标时用标题首字占位', function () {
    renderTile(buildTile())

    expect(screen.getByText('G')).toBeTruthy()
    expect(screen.getByText('GitHub')).toBeTruthy()
  })

  it('点击在当前标签打开链接', function () {
    renderTile(buildTile())
    fireEvent.click(screen.getByText('GitHub'))

    expect(openSite).toHaveBeenCalledWith('https://github.com', 'here')
  })

  it('没有链接时不打开', function () {
    renderTile(buildTile({ url: null }))
    fireEvent.click(screen.getByText('GitHub'))

    expect(openSite).not.toHaveBeenCalled()
  })
})
