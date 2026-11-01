import {
  createContext,
  startTransition,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject
} from 'react'

import type { BoothBucket, NavigateBucket } from '@/constants/marketplace/buckets'

type MarketplaceMode = 'booth' | 'navigate' | 'customize'

interface MarketplaceContextProps {
  mode: MarketplaceMode
  onUpdateMode: (mode: MarketplaceMode) => void
  boothBucket: BoothBucket
  onUpdateBoothBucket: (bucket: BoothBucket) => void
  navigateBucket: NavigateBucket
  onUpdateNavigateBucket: (bucket: NavigateBucket) => void
  query: string
  onUpdateQuery: (query: string) => void
  targetMirrorID: string | undefined
  onUpdateTargetMirrorID: (mirrorID: string | undefined) => void
  searchInputRef: RefObject<HTMLInputElement | null>
  mirrorTriggerRef: RefObject<HTMLInputElement | null>
  focusSearch(): void
  focusMirrorSelect(): void
  clearQuery(): void
}

const MarketplaceContext = createContext<MarketplaceContextProps>({
  mode: 'booth',
  onUpdateMode: function () {},
  boothBucket: 'all',
  onUpdateBoothBucket: function () {},
  navigateBucket: 'all',
  onUpdateNavigateBucket: function () {},
  query: '',
  onUpdateQuery: function () {},
  targetMirrorID: undefined,
  onUpdateTargetMirrorID: function () {},
  searchInputRef: { current: null },
  mirrorTriggerRef: { current: null },
  focusSearch() {},
  focusMirrorSelect() {},
  clearQuery() {}
})

interface MarketplaceProviderProps {
  children: ReactNode
}

function MarketplaceProvider(props: MarketplaceProviderProps) {
  const [mode, onUpdateMode] = useState<MarketplaceMode>('booth')
  const [boothBucket, onUpdateBoothBucketRaw] = useState<BoothBucket>('all')
  const [navigateBucket, onUpdateNavigateBucketRaw] = useState<NavigateBucket>('all')
  const [query, onUpdateQuery] = useState('')
  const [targetMirrorID, onUpdateTargetMirrorID] = useState<string | undefined>(undefined)
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const mirrorTriggerRef = useRef<HTMLInputElement | null>(null)

  const value = useMemo(
    function () {
      return {
        mode,
        onUpdateMode,
        boothBucket,
        onUpdateBoothBucket(bucket: BoothBucket) {
          // 分类切换可能触发大网格 reconcile；降为 transition 保分类条跟手
          startTransition(function () {
            onUpdateBoothBucketRaw(bucket)
          })
        },
        navigateBucket,
        onUpdateNavigateBucket(bucket: NavigateBucket) {
          startTransition(function () {
            onUpdateNavigateBucketRaw(bucket)
          })
        },
        query,
        onUpdateQuery,
        targetMirrorID,
        onUpdateTargetMirrorID,
        searchInputRef,
        mirrorTriggerRef,
        focusSearch() {
          searchInputRef.current?.focus()
          searchInputRef.current?.select()
        },
        focusMirrorSelect() {
          const node = mirrorTriggerRef.current
          if (!node) return
          node.focus()
          node.select()
        },
        clearQuery() {
          onUpdateQuery('')
        }
      }
    },
    [mode, boothBucket, navigateBucket, query, targetMirrorID]
  )

  return <MarketplaceContext value={value}>{props.children}</MarketplaceContext>
}

export { MarketplaceContext, MarketplaceProvider }
export type { MarketplaceMode }
