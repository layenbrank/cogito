import * as React from 'react'

/** 尊重应用壳 `html[data-motion=reduce]` 与系统 prefers-reduced-motion */
function useAppReducedMotion() {
  const [isReduced, setReduced] = React.useState(function () {
    if (typeof document === 'undefined') return false
    if (document.documentElement.getAttribute('data-motion') === 'reduce') return true
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  })

  React.useEffect(function () {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')

    function sync() {
      const byAttr = document.documentElement.getAttribute('data-motion') === 'reduce'
      setReduced(byAttr || media.matches)
    }

    sync()
    media.addEventListener('change', sync)
    const observer = new MutationObserver(sync)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-motion']
    })

    return function () {
      media.removeEventListener('change', sync)
      observer.disconnect()
    }
  }, [])

  return isReduced
}

export { useAppReducedMotion }
