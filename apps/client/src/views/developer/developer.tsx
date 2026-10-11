import { Icon } from '@iconify/react/offline'
import { Dialog, DialogContent } from '@i-thinking/design/components/dialog'
import { ToggleGroup, ToggleGroupItem } from '@i-thinking/design/components/toggle-group'
import { invoke } from '@tauri-apps/api/core'
import { useEffect, useState } from 'react'
import { CHANNELS } from '@/shared/ipc/channels'

import { Decorations } from '@/components/decorations/index.ts'
import { findComponentLabel } from '@/constants/marketplace/tile-hints'
import { PanelList } from './panel-list'

type SegmentedGenre = 'collection' | 'mirror'

interface SegmentedOption {
  value: SegmentedGenre
  label: string
  icon: string
}

interface OSGenre {
  OS: string
  version: string
  kernel: string
  hostname: string
  CPU: {
    brand: string
    frequency: number
    cores: number
    arch: string
  }
  memory: {
    total: number
    used: number
  }
  swap: {
    total: number
    used: number
  }
}

const SEGMENTED_OPTIONS: SegmentedOption[] = [
  {
    value: 'collection',
    label: '合集',
    icon: 'lucide:list'
  },
  {
    value: 'mirror',
    label: '镜像',
    icon: 'lucide:layout-grid'
  }
]

const EMPTY_OS: OSGenre = {
  OS: 'unknown',
  version: 'unknown',
  kernel: 'unknown',
  hostname: 'unknown',
  CPU: {
    brand: 'unknown',
    frequency: 0,
    cores: 0,
    arch: 'unknown'
  },
  memory: {
    total: 0,
    used: 0
  },
  swap: {
    total: 0,
    used: 0
  }
}

function Developer() {
  const [OS, updateOS] = useState<OSGenre>(EMPTY_OS)
  const [drawerVisible, updateDrawerVisible] = useState(false)
  const [segmented, updateSegmented] = useState<SegmentedGenre>('collection')

  useEffect(function () {
    void invoke<OSGenre>(CHANNELS.SYSTEM.OS).then(updateOS)
  }, [])

  return (
    <Decorations
      summary={findComponentLabel('developer')}
      scrollable={false}>
      <div className="flex min-h-0 flex-1 items-stretch gap-1.5 p-1.5">
        <div className="w-34 shrink-0 overflow-y-auto scroll-smooth">
          <ToggleGroup
            orientation="vertical"
            spacing={0}
            value={[segmented]}
            onValueChange={function (value) {
              const next = value[0] as SegmentedGenre | undefined
              if (next) updateSegmented(next)
            }}
            className="w-full items-stretch rounded-lg border border-border bg-card p-1 shadow-sm">
            {SEGMENTED_OPTIONS.map(function (option) {
              return (
                <ToggleGroupItem
                  key={option.value}
                  value={option.value}
                  className="h-8 justify-start gap-2 px-2 text-muted-foreground data-[pressed]:bg-primary/10 data-[pressed]:text-primary">
                  <Icon
                    icon={option.icon}
                    aria-hidden
                  />
                  {option.label}
                </ToggleGroupItem>
              )
            })}
          </ToggleGroup>
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <PanelList
            onOpenConsole={function () {
              updateDrawerVisible(true)
            }}
          />
        </div>

        <Dialog
          open={drawerVisible}
          onOpenChange={updateDrawerVisible}>
          <DialogContent
            showCloseButton={false}
            className="top-0! right-0! left-auto! h-full! max-h-none! w-100 max-w-100! translate-x-0! translate-y-0! rounded-none rounded-l-xl">
            <pre className="text-xs leading-relaxed">{JSON.stringify(OS, null, 2)}</pre>
          </DialogContent>
        </Dialog>
      </div>
    </Decorations>
  )
}

export default Developer
