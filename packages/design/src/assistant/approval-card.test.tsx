import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { ApprovalCard } from './approval-card'

const noop = function () {}

function markup(props: Record<string, unknown> = {}) {
  return renderToStaticMarkup(
    <ApprovalCard
      state="request"
      title="Run command"
      subtitle="The agent wants to run a shell command"
      command="pnpm vitest run --changed"
      onAllowOnce={noop}
      onAlwaysAllow={noop}
      onDeny={noop}
      {...props}
    />
  )
}

function count(html: string, needle: string): number {
  return html.split(needle).length - 1
}

describe('ApprovalCard', function () {
  it('请求态：group 指着标题，三个动作按 Deny / Always allow / Allow once 排', function () {
    const html = markup()
    expect(html).toContain('data-slot="approval-card"')
    expect(html).toContain('data-variant="default"')
    expect(html).toContain('role="group"')
    const labelledBy = html.match(/aria-labelledby="([^"]+)"/)?.[1]
    expect(labelledBy).toBeTruthy()
    expect(html).toContain('id="' + labelledBy + '"')
    expect(html).toContain('Run command')

    const deny = html.indexOf('data-slot="approval-card-deny"')
    const always = html.indexOf('data-slot="approval-card-always-allow"')
    const once = html.indexOf('data-slot="approval-card-allow-once"')
    expect(deny).toBeGreaterThan(0)
    expect(deny).toBeLessThan(always)
    expect(always).toBeLessThan(once)
    expect(html).toContain('>Deny</button>')
    expect(html).toContain('>Always allow</button>')
    expect(html).toContain('>Allow once</button>')
  })

  it('主按钮是实心反色底，另外两个是 ghost', function () {
    const html = markup()
    const once = html.indexOf('data-slot="approval-card-allow-once"')
    const onceTag = html.slice(html.lastIndexOf('<button', once), html.indexOf('>', once))
    expect(onceTag).toContain('bg-foreground text-background')
    const deny = html.indexOf('data-slot="approval-card-deny"')
    const denyTag = html.slice(html.lastIndexOf('<button', deny), html.indexOf('>', deny))
    expect(denyTag).not.toContain('bg-foreground text-background')
    expect(denyTag).toContain('hover:bg-foreground/[0.06]')
  })

  it('命令面板是可选的一段等宽文字', function () {
    expect(markup()).toContain('data-slot="approval-card-command"')
    expect(markup()).toContain('pnpm vitest run --changed')
    const without = markup({ command: undefined })
    expect(without).not.toContain('data-slot="approval-card-command"')
    expect(without).not.toContain('pnpm vitest run --changed')
  })

  it('明细按标签 / 值两列排', function () {
    const html = markup({
      details: [
        { label: 'Conversations', value: '12 archived' },
        { label: 'Generated files', value: '38 files' }
      ]
    })
    expect(html).toContain('data-slot="approval-card-details"')
    expect(html).toContain('<dt')
    expect(html).toContain('Conversations')
    expect(html).toContain('38 files')
  })

  it('destructive 只改色调：图标块与主按钮走失败色', function () {
    const html = markup({ variant: 'destructive' })
    expect(html).toContain('data-variant="destructive"')
    expect(html).toContain('bg-destructive/10 text-destructive')
    const once = html.indexOf('data-slot="approval-card-allow-once"')
    const onceTag = html.slice(html.lastIndexOf('<button', once), html.indexOf('>', once))
    expect(onceTag).toContain('bg-destructive text-background')
  })

  it('done：按钮不再渲染，footer 是实时收据，默认读 Finished', function () {
    const html = markup({ state: 'done' })
    expect(count(html, 'data-slot="approval-card-deny"')).toBe(0)
    expect(count(html, 'data-slot="approval-card-allow-once"')).toBe(0)
    expect(html).toContain('data-slot="approval-card-status"')
    expect(html).toContain('role="status"')
    expect(html).toContain('aria-live="polite"')
    expect(html).toContain('Finished')
  })

  it('running / denied 的收据各自读自己的词', function () {
    expect(markup({ state: 'running' })).toContain('Running')
    expect(markup({ state: 'denied' })).toContain('Denied')
  })

  it('statusLabel 覆盖收据文案', function () {
    const html = markup({ state: 'done', statusLabel: 'Published 0.14.1' })
    expect(html).toContain('Published 0.14.1')
    expect(html).not.toContain('Finished')
  })

  it('description 进 aria-describedby', function () {
    const html = markup({ description: 'This runs the tests affected by the change.' })
    const describedBy = html.match(/aria-describedby="([^"]+)"/)?.[1]
    expect(describedBy).toBeTruthy()
    expect(html).toContain('id="' + describedBy + '"')
    expect(html).toContain('This runs the tests affected by the change.')
    // 没有 description 就不该留一个指向空气的 aria-describedby
    expect(markup()).not.toContain('aria-describedby')
  })

  it('缺省文案走 labels：空标题、按钮默认词', function () {
    const html = markup({ title: '' })
    expect(html).toContain('Approval needed')
    expect(html).toContain('>Deny</button>')
  })

  it('extraActions 插在 Deny 左侧', function () {
    const html = markup({
      extraActions: [{ key: 'reject-always', label: 'Always deny', onSelect: noop }]
    })
    const extra = html.indexOf('data-slot="approval-card-extra"')
    expect(extra).toBeGreaterThan(0)
    expect(extra).toBeLessThan(html.indexOf('data-slot="approval-card-deny"'))
    expect(html).toContain('>Always deny</button>')
  })

  it('pending 时三个按钮一起禁用', function () {
    const html = markup({ pending: true })
    expect(count(html, 'disabled=""')).toBe(3)
  })

  it('没收据就不该有 status 区块', function () {
    expect(markup()).not.toContain('data-slot="approval-card-status"')
  })
})
