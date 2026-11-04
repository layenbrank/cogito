import { Button } from '@cogito/design/components/button'
import { useEffect } from 'react'

import { reportUnknown } from '@/utils/exception-report.ts'

/**
 * 启动期（`ensurePersist` / `ensureSecrets` / 字典 bootstrap）失败时的兜底页。
 *
 * 这一层必须**不依赖任何 store / provider / router**：bootstrap 挂掉时这些很可能
 * 也没起来，能用的只有 React 与设计系统组件。目标只有一个 —— 不要让用户看到白屏。
 */
function BootstrapFailure({ error }: { error: unknown }) {
  useEffect(
    function () {
      reportUnknown(error, { kind: 'bootstrap' }, 'fatal')
    },
    [error]
  )

  const message = error instanceof Error ? error.message : String(error)

  return (
    <div
      className="flex h-screen w-screen flex-col items-center justify-center gap-3 bg-background p-8 text-center"
      role="alert">
      <h1 className="text-lg font-medium">启动失败</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        应用初始化没有完成，日志已经记录。可以重试；如果反复失败，请到「设置 → 诊断」导出日志反馈。
      </p>
      {import.meta.env.DEV ? (
        <p className="max-w-full break-all rounded-md bg-muted px-3 py-2 text-left text-xs text-destructive">
          {message}
        </p>
      ) : null}
      <div className="mt-2 flex items-center gap-3">
        <Button
          onClick={function () {
            window.location.reload()
          }}>
          重试
        </Button>
      </div>
    </div>
  )
}

export { BootstrapFailure }
