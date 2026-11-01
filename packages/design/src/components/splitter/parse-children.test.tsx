import { describe, expect, it } from 'vitest'

import { SplitterHandle } from './splitter-handle'
import { SplitterPane } from './splitter-pane'
import { flattenElements, parseChildren } from './parse-children'

describe('parseChildren', function () {
  it('展开条件渲染 Fragment 里的 pane/handle（React 19 Children.toArray 不会展）', function () {
    const isOpen = true
    const { panes, handles } = parseChildren(
      <>
        <SplitterPane
          id="main"
          defaultSize="70%">
          main
        </SplitterPane>
        {isOpen ? (
          <>
            <SplitterHandle withHandle />
            <SplitterPane
              id="bottom"
              defaultSize="30%">
              bottom
            </SplitterPane>
          </>
        ) : null}
      </>
    )

    expect(panes.map(function (pane) {
      return pane.id
    })).toEqual(['main', 'bottom'])
    expect(handles).toHaveLength(1)
    expect(handles[0]?.withHandle).toBe(true)
  })

  it('展开前置 Fragment（侧栏 + handle + 主栏）', function () {
    const isSidebarOpen = true
    const { panes } = parseChildren(
      <>
        {isSidebarOpen ? (
          <>
            <SplitterPane
              id="sidebar"
              defaultSize="18%">
              side
            </SplitterPane>
            <SplitterHandle withHandle />
          </>
        ) : null}
        <SplitterPane
          id="editor"
          defaultSize="82%">
          editor
        </SplitterPane>
      </>
    )

    expect(panes.map(function (pane) {
      return pane.id
    })).toEqual(['sidebar', 'editor'])
  })

  it('flattenElements 自己展开嵌套 Fragment', function () {
    const nodes = flattenElements(
      <>
        <SplitterPane id="a">a</SplitterPane>
        <>
          <SplitterHandle />
          <SplitterPane id="b">b</SplitterPane>
        </>
      </>
    )
    expect(nodes).toHaveLength(3)
  })
})
