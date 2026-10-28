import { Icon } from '@iconify/react/offline'
import * as monaco from 'monaco-editor'
import { useEffect, useState } from 'react'

import { useCodeStore } from '@/stores/code'
import { findModel } from '@/views/code/lib/monaco-models.ts'
import { findModelMarkers, pushProblemCounts } from '@/views/code/lib/monaco-markers.ts'

interface ProblemRow {
  message: string
  severity: monaco.MarkerSeverity
  line: number
  column: number
  source?: string
}

function severityLabel(severity: monaco.MarkerSeverity): string {
  if (severity === monaco.MarkerSeverity.Error) return '错误'
  if (severity === monaco.MarkerSeverity.Warning) return '警告'
  if (severity === monaco.MarkerSeverity.Info) return '信息'
  return '提示'
}

function Problems() {
  const activeTabId = useCodeStore(function (state) {
    return state.activeTabId
  })
  const tabs = useCodeStore(function (state) {
    return state.tabs
  })
  const activeTab = tabs.find(function (tab) {
    return tab.id === activeTabId
  })
  const [rows, setRows] = useState<ProblemRow[]>([])

  useEffect(
    function () {
      function refresh() {
        const model = activeTab ? findModel(activeTab.path) : null
        if (!model) {
          setRows([])
          pushProblemCounts(null)
          return
        }
        const markers = findModelMarkers(model)
        setRows(
          markers.map(function (marker) {
            return {
              message: marker.message,
              severity: marker.severity,
              line: marker.startLineNumber,
              column: marker.startColumn,
              source: marker.source
            }
          })
        )
        pushProblemCounts(model)
      }

      refresh()
      const disposable = monaco.editor.onDidChangeMarkers(function () {
        refresh()
      })
      return function () {
        disposable.dispose()
      }
    },
    [activeTab]
  )

  if (rows.length === 0) {
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center gap-2 text-xs">
        <Icon
          icon="lucide:circle-check"
          className="size-4"
        />
        当前文件无问题
      </div>
    )
  }

  return (
    <ul className="h-full overflow-y-auto p-1 text-xs">
      {rows.map(function (row) {
        return (
          <li
            key={`${row.line}:${row.column}:${row.severity}:${row.message}`}
            className="hover:bg-muted flex items-start gap-2 rounded-sm px-2 py-1">
            <span className="text-muted-foreground shrink-0">{severityLabel(row.severity)}</span>
            <span className="text-foreground min-w-0 flex-1 wrap-break-word">{row.message}</span>
            <span className="text-muted-foreground shrink-0">
              Ln {row.line}, Col {row.column}
            </span>
          </li>
        )
      })}
    </ul>
  )
}

export { Problems }
