import { Icon } from '@iconify/react/offline'
import { Button } from '@i-thinking/design/components/button'

import { isUrlKeyword } from '@/views/browser/engine/engine-url'
import { AddressBar } from '@/views/navigation/address-bar'

interface OmniboxProps {
  address: string
  engineKey: string
  canBack: boolean
  canForward: boolean
  onAddress: (value: string) => void
  onSubmit: (url: string, query?: string) => void
  onEngine: (key: string) => void
  onHome: () => void
  onBack: () => void
  onForward: () => void
  onReload: () => void
}

/**
 * 地址栏行：导航按钮 + 输入框。
 *
 * 建议列表不在这一层画：它是独立子 WebView（`navigation-popup`），
 * 由 `AddressBar` 直接推帧，所以网页既不会被顶下去，也不会被裁掉。
 */
function Omnibox(props: OmniboxProps) {
  function submit(url: string) {
    const keyword = props.address.trim()
    props.onSubmit(url, keyword && !isUrlKeyword(keyword) ? keyword : undefined)
  }

  return (
    <div className="relative flex h-full min-w-0 flex-1 items-center px-1">
      <div className="flex shrink-0 items-center">
        <Button
          variant="ghost"
          size="icon"
          data-region="false"
          className="size-10 min-w-10 rounded-full [&_svg]:size-4.5"
          aria-label="后退"
          disabled={!props.canBack}
          onClick={props.onBack}>
          <Icon
            icon="lucide:arrow-left"
            aria-hidden
          />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          data-region="false"
          className="size-10 min-w-10 rounded-full [&_svg]:size-4.5"
          aria-label="前进"
          disabled={!props.canForward}
          onClick={props.onForward}>
          <Icon
            icon="lucide:arrow-right"
            aria-hidden
          />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          data-region="false"
          className="size-10 min-w-10 rounded-full [&_svg]:size-4.5"
          aria-label="重新加载"
          disabled={!props.canBack}
          onClick={props.onReload}>
          <Icon
            icon="lucide:rotate-cw"
            aria-hidden
          />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          data-region="false"
          className="size-10 min-w-10 rounded-full [&_svg]:size-4.5"
          aria-label="主页"
          onClick={props.onHome}>
          <Icon
            icon="lucide:house"
            aria-hidden
          />
        </Button>
      </div>
      <div className="ml-1 min-w-0 flex-1">
        <AddressBar
          value={props.address}
          engineKey={props.engineKey}
          onValue={props.onAddress}
          onSubmit={submit}
          onEngine={props.onEngine}
        />
      </div>
    </div>
  )
}

export { Omnibox }
