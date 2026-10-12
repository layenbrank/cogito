/**
 * session/request_permission（仅 ACP SDK 1.3）
 */
import type {
  PermissionOption,
  RequestPermissionRequest,
  RequestPermissionResponse
} from '@agentclientprotocol/sdk'
import { Button } from '@i-thinking/design/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@i-thinking/design/components/dialog'
import { createElement, useState } from 'react'
import { createRoot } from 'react-dom/client'

const ALLOW_KINDS = new Set(['allow_once', 'allow_always'])

function isAllowOption(option: PermissionOption): boolean {
  return ALLOW_KINDS.has(option.kind)
}

function formatToolDetail(params: RequestPermissionRequest): string {
  const title = params.toolCall.title?.trim()
  const input = params.toolCall.rawInput
  const lines: string[] = []
  if (title) lines.push(title)
  if (input !== undefined) {
    try {
      lines.push(JSON.stringify(input, null, 2))
    } catch (error) {
      // 循环引用 / BigInt 等：退回 String()，但要留痕
      console.warn('[acp-permission] toolCall.rawInput 无法序列化，退回 String():', error)
      lines.push(String(input))
    }
  }
  if (lines.length === 0) return '代理请求执行一项可能敏感的操作'
  return lines.join('\n\n')
}

function selectedResponse(optionId: string): RequestPermissionResponse {
  return {
    outcome: {
      outcome: 'selected',
      optionId
    }
  }
}

function cancelledResponse(): RequestPermissionResponse {
  return {
    outcome: {
      outcome: 'cancelled'
    }
  }
}

interface PermissionDialogProps {
  params: RequestPermissionRequest
  onResolve(response: RequestPermissionResponse): void
}

function PermissionDialog(props: PermissionDialogProps) {
  const [open, setOpen] = useState(true)
  const options = props.params.options ?? []
  const heading = props.params.toolCall.title?.trim() || 'Goose 请求权限'
  const detail = formatToolDetail(props.params)

  function finish(response: RequestPermissionResponse) {
    setOpen(false)
    props.onResolve(response)
  }

  return createElement(
    Dialog,
    {
      open,
      disablePointerDismissal: true,
      onOpenChange(nextOpen: boolean) {
        if (!nextOpen) finish(cancelledResponse())
      }
    },
    createElement(
      DialogContent,
      { className: 'sm:max-w-lg' },
      createElement(
        DialogHeader,
        null,
        createElement(DialogTitle, null, heading),
        createElement(
          DialogDescription,
          { className: 'sr-only' },
          '代理请求执行一项可能敏感的操作，请选择处理方式'
        )
      ),
      createElement(
        'pre',
        {
          className:
            'bg-muted/40 max-h-60 overflow-auto rounded-md p-3 text-xs break-words whitespace-pre-wrap'
        },
        detail
      ),
      createElement(
        DialogFooter,
        null,
        ...options.map(function (option) {
          return createElement(
            Button,
            {
              key: option.optionId,
              variant: isAllowOption(option) ? 'default' : 'outline',
              onClick() {
                finish(selectedResponse(option.optionId))
              }
            },
            option.name || option.kind
          )
        }),
        options.length === 0
          ? createElement(
              Button,
              {
                variant: 'outline',
                onClick() {
                  finish(cancelledResponse())
                }
              },
              '取消'
            )
          : null
      )
    )
  )
}

async function requestAcpPermission(
  params: RequestPermissionRequest
): Promise<RequestPermissionResponse> {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)

  return new Promise(function (resolve) {
    function dispose(response: RequestPermissionResponse) {
      resolve(response)
      queueMicrotask(function () {
        root.unmount()
        host.remove()
      })
    }

    root.render(
      createElement(PermissionDialog, {
        params,
        onResolve: dispose
      })
    )
  })
}

export { requestAcpPermission }
