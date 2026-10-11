import { Icon } from '@iconify/react/offline'
import { Button } from '@i-thinking/design/components/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@i-thinking/design/components/tooltip'
import { openUrl } from '@tauri-apps/plugin-opener'
import { useMemo } from 'react'

import { Decorations } from '@/components/decorations/index.ts'
import { findComponentLabel } from '@/constants/marketplace/tile-hints'

const SANDBOX_PERMISSIONS = [
  'accelerometer',
  'autoplay',
  'camera',
  'clipboard-read',
  'clipboard-write',
  'encrypted-media',
  'fullscreen',
  'geolocation',
  'gyroscope',
  'magnetometer',
  'microphone',
  'midi',
  'payment',
  'picture-in-picture',
  'publickey-credentials-get',
  'screen-wake-lock',
  'speaker-selection',
  'usb',
  'web-share',
  'xr-spatial-tracking'
].join('; ')

/** 网址磁贴窗口：内嵌站点；记录上的 url 经查询串传入（窗口拿不到磁贴记录） */
export default function Navigation() {
  const url = useMemo(function () {
    return new URLSearchParams(location.search).get('url') ?? ''
  }, [])

  return (
    <Decorations
      summary={findComponentLabel('navigation')}
      scrollable={false}
      final={
        url ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="在浏览器打开"
                  className="rounded-md text-muted-foreground"
                  onClick={function () {
                    void openUrl(url)
                  }}
                />
              }>
              <Icon
                icon="lucide:external-link"
                aria-hidden
              />
            </TooltipTrigger>
            <TooltipContent side="bottom">在浏览器打开</TooltipContent>
          </Tooltip>
        ) : null
      }>
      {url ? (
        <iframe
          src={url}
          title={url}
          sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox"
          referrerPolicy="unsafe-url"
          allow={SANDBOX_PERMISSIONS}
          allowFullScreen
          loading="eager"
          className="h-full w-full border-0"
        />
      ) : (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          未配置网址
        </div>
      )}
    </Decorations>
  )
}
