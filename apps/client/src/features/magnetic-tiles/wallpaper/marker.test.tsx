import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { WALLPAPER_FRAMES } from './catalog'
import Marker from './marker'

describe('wallpaper library marker', function () {
  it('shows a contact sheet instead of one full-bleed photo', function () {
    const view = render(
      <Marker
        size={1}
        shape="square"
        direction="horizontal"
        title="壁纸库"
        url={null}
      />
    )

    const earth = screen.getByRole('img', { name: '地球' })
    const rise = screen.getByRole('img', { name: '地出' })
    expect(earth).toHaveAttribute('src', WALLPAPER_FRAMES[0].src)
    expect(earth.className).toContain('object-cover')
    expect(rise).toBeVisible()
    expect(screen.queryByText('NASA')).toBeNull()
    view.unmount()
  })

  it('clips the sheet inside the circle and counts the frames that do not fit', function () {
    render(
      <Marker
        size={1}
        shape="circle"
        direction="vertical"
        title="壁纸库"
        url={WALLPAPER_FRAMES[1].src}
      />
    )

    const featured = screen.getByRole('img', { name: '地出' })
    expect(featured.closest('.rounded-full')).toBeTruthy()
    expect(featured.closest('.h-\\[70\\.7\\%\\]')).toBeTruthy()
    expect(screen.getByText('+2')).toBeVisible()
  })
})
