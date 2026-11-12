/**
 * `useSessionThreadID`：把列表项 id 折成**库内会话 id**。
 *
 * 这条折算不是洁癖：ACP session、goose 用量、手动压缩都按 remoteId 登记，
 * 拿草稿 id 去查一律扑空 —— 压缩按钮永远灰着、点了说「尚无会话」，用量读成 0。
 */
import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = {
  threads: {
    mainThreadId: 'local-1' as string | null,
    threadItems: [{ id: 'local-1', remoteId: 'remote-1' as string | null }]
  }
}

vi.mock('@assistant-ui/react', function () {
  return {
    useAuiState: function (selector: (value: typeof state) => unknown) {
      return selector(state)
    }
  }
})

import { useSessionThreadID } from './use-session-thread-id'

function Probe() {
  const threadID = useSessionThreadID()
  return <span data-testid="thread-id">{threadID ?? 'null'}</span>
}

describe('useSessionThreadID', function () {
  beforeEach(function () {
    state.threads.mainThreadId = 'local-1'
    state.threads.threadItems = [{ id: 'local-1', remoteId: 'remote-1' }]
  })

  it('列表项 id 落库后是草稿 id：折成 remoteId', function () {
    render(<Probe />)
    expect(screen.getByTestId('thread-id')).toHaveTextContent('remote-1')
  })

  it('还没落库（草稿）时退回列表项 id，而不是 null', function () {
    state.threads.threadItems = [{ id: 'local-1', remoteId: null }]
    render(<Probe />)
    expect(screen.getByTestId('thread-id')).toHaveTextContent('local-1')
  })

  it('没有当前会话时是 null', function () {
    state.threads.mainThreadId = null
    render(<Probe />)
    expect(screen.getByTestId('thread-id')).toHaveTextContent('null')
  })
})
