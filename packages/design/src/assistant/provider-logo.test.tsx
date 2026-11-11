import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { findProviderLogoIcon, ProviderLogo } from './provider-logo'

vi.mock('@iconify/react/offline', function () {
  return {
    Icon: function StubIcon(props: { icon: string; width?: number; height?: number }) {
      return (
        <span
          data-icon={props.icon}
          data-size={props.width}
        />
      )
    }
  }
})

describe('findProviderLogoIcon', function () {
  it('已知接入给品牌 logo（simple-icons）', function () {
    expect(findProviderLogoIcon('openai')).toBe('simple-icons:openai')
    expect(findProviderLogoIcon('anthropic')).toBe('simple-icons:anthropic')
    expect(findProviderLogoIcon('google_gemini')).toBe('simple-icons:googlegemini')
    expect(findProviderLogoIcon('aws-bedrock')).toBe('simple-icons:amazonwebservices')
  })

  it('自定义 id 按品牌词兜底命中', function () {
    expect(findProviderLogoIcon('custom-deepseek')).toBe('simple-icons:deepseek')
    expect(findProviderLogoIcon('my-kimi-key')).toBe('simple-icons:moonshotai')
    expect(findProviderLogoIcon('Cursor-Agent')).toBe('simple-icons:cursor')
  })

  it('认不出的接入落回 lucide 占位，不给空白方块', function () {
    expect(findProviderLogoIcon('zhipu')).toBe('lucide:brain')
    expect(findProviderLogoIcon('cogito-gateway')).toBe('lucide:building-2')
    expect(findProviderLogoIcon('')).toBe('lucide:box')
  })
})

describe('ProviderLogo', function () {
  it('渲染成图标并带上尺寸', function () {
    const html = renderToStaticMarkup(
      <ProviderLogo
        kind="openai"
        size={18}
      />
    )
    expect(html).toContain('data-icon="simple-icons:openai"')
    expect(html).toContain('data-size="18"')
  })
})
