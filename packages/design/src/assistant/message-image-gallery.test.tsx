import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { MessageImageGallery } from './message-image-gallery'

function images(count: number) {
  return Array.from({ length: count }, function (_unused, index) {
    return { src: `data:image/png;base64,${index}`, filename: `pic-${index}.png` }
  })
}

describe('MessageImageGallery', function () {
  it('单图保留原始比例，统一圆角', function () {
    const html = renderToStaticMarkup(<MessageImageGallery images={images(1)} />)
    expect(html).toContain('data-count="1"')
    expect(html).toContain('rounded-xl')
    expect(html).toContain('object-contain')
  })

  it('多图切成网格，收起时最多露 4 格，其余叠 +N', function () {
    const html = renderToStaticMarkup(<MessageImageGallery images={images(6)} />)
    expect(html).toContain('grid-cols-3')
    expect(html.match(/data-slot="message-image-gallery-tile"/g)).toHaveLength(3)
    expect(html.match(/data-slot="message-image-gallery-more"/g)).toHaveLength(1)
    expect(html).toContain('+2')
  })

  it('两张并排两列，不出现 +N', function () {
    const html = renderToStaticMarkup(<MessageImageGallery images={images(2)} />)
    expect(html).toContain('grid-cols-2')
    expect(html).not.toContain('message-image-gallery-more')
  })

  it('没有图片时什么都不渲染', function () {
    expect(renderToStaticMarkup(<MessageImageGallery images={[]} />)).toBe('')
  })
})