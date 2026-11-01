import * as React from 'react'

interface OverlayPortalContextValue {
  container: HTMLElement | null
}

const OverlayPortalContext = React.createContext<OverlayPortalContextValue>({
  container: null
})

function OverlayPortalProvider(props: {
  container: HTMLElement | null
  children: React.ReactNode
}) {
  const value = React.useMemo(
    function () {
      return { container: props.container }
    },
    [props.container]
  )

  return (
    <OverlayPortalContext.Provider value={value}>
      {props.children}
    </OverlayPortalContext.Provider>
  )
}

/** 桌面壳内容区 Portal 容器；无 provider 时为 null（回退 document.body） */
function useOverlayPortalContainer(): HTMLElement | null {
  return React.useContext(OverlayPortalContext).container
}

export { OverlayPortalProvider, useOverlayPortalContainer }
