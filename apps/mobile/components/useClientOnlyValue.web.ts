import React from 'react'

// Web：客户端与服务端快照分流。`useSyncExternalStore` 的 getServerSnapshot
// 在 SSR 返回 server，hydrate 后走 getSnapshot 返回 client —— 不必在 effect 里 setState。
export function useClientOnlyValue<S, C>(server: S, client: C): S | C {
  return React.useSyncExternalStore(
    function subscribe() {
      return function unsubscribe() {}
    },
    function getSnapshot() {
      return client
    },
    function getServerSnapshot() {
      return server
    }
  )
}
