import { OverlayPortalProvider } from '@cogito/design/components/overlay-portal'
import { cn } from 'cn'
import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
  type RefCallback
} from 'react'

interface ShellOverlayContextValue {
  host: HTMLElement | null
}

const ShellOverlayContext = createContext<ShellOverlayContextValue>({ host: null })

function useShellOverlayHost(): HTMLElement | null {
  return useContext(ShellOverlayContext).host
}

interface ShellOverlayHostProps {
  children: ReactNode
  className?: string
}

/**
 * Caption 下方内容列：承载页面，并作为 Dialog/Sheet Portal 容器，
 * 使遮罩几何上无法盖住操作栏。
 */
function ShellOverlayHost(props: ShellOverlayHostProps) {
  const [host, updateHost] = useState<HTMLElement | null>(null)

  const bindHost: RefCallback<HTMLDivElement> = function (node) {
    updateHost(node)
  }

  const value = useMemo(
    function () {
      return { host }
    },
    [host]
  )

  return (
    <ShellOverlayContext.Provider value={value}>
      <OverlayPortalProvider container={host}>
        <div
          ref={bindHost}
          data-shell-overlay-host=""
          className={cn(
            'relative flex min-h-0 min-w-0 flex-1 flex-col',
            props.className
          )}>
          {props.children}
        </div>
      </OverlayPortalProvider>
    </ShellOverlayContext.Provider>
  )
}

export { ShellOverlayHost, useShellOverlayHost }
