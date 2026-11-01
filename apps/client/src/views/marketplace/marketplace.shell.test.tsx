import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { useContext } from 'react'
import { describe, expect, it } from 'vitest'

import {
  MarketplaceContext,
  MarketplaceProvider
} from '@/views/marketplace/workspace/context.tsx'

/** 模拟 Caption 槽里依赖 MarketplaceContext 的控件 */
function ModeProbe() {
  const { mode, onUpdateMode } = useContext(MarketplaceContext)
  return (
    <button
      type="button"
      onClick={function () {
        onUpdateMode('navigate')
      }}>
      {mode}
    </button>
  )
}

function BodyMode() {
  const { mode } = useContext(MarketplaceContext)
  return <span data-testid="body-mode">{mode}</span>
}

describe('marketplace shell context bridge', function () {
  it('Caption 在 Provider 外时点 Tab 改不了页内 mode', function () {
    render(
      <>
        <ModeProbe />
        <MarketplaceProvider>
          <BodyMode />
        </MarketplaceProvider>
      </>
    )

    fireEvent.click(screen.getByRole('button'))

    expect(screen.getByTestId('body-mode')).toHaveTextContent('booth')
    expect(screen.getByRole('button')).toHaveTextContent('booth')
  })

  it('把同一 value 挂到槽节点后，Caption 与页内 mode 同步', function () {
    function Page() {
      const marketplace = useContext(MarketplaceContext)
      return (
        <>
          <div data-testid="caption">
            <MarketplaceContext value={marketplace}>
              <ModeProbe />
            </MarketplaceContext>
          </div>
          <BodyMode />
        </>
      )
    }

    render(
      <MarketplaceProvider>
        <Page />
      </MarketplaceProvider>
    )

    fireEvent.click(screen.getByRole('button'))

    expect(screen.getByTestId('body-mode')).toHaveTextContent('navigate')
    expect(screen.getByRole('button')).toHaveTextContent('navigate')
  })
})
