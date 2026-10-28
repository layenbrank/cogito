/**
 * Everything 式结果列表（栏下非模态）
 */
import { Button } from '@cogito/design/components/button'
import { Icon } from '@iconify/react/offline'
import { cn } from 'cn'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'

import { DOMAIN_LABEL, FILTER_CHIPS } from '@/features/command-bar/constants'
import { findFlatHits, groupHits } from '@/features/command-bar/rank'
import type { DomainFilter, Hit } from '@/features/command-bar/types'

interface ResultsSurfaceProps {
  hits: Hit[]
  navigation: number
  filter: DomainFilter
  isOpen: boolean
  onFilter: (filter: DomainFilter) => void
  onNavigate: (index: number) => void
  onSelect: (hit: Hit) => void
}

function ResultsSurface(props: ResultsSurfaceProps) {
  const isReduced = useReducedMotion()
  const flatHits = findFlatHits(props.hits)
  const groups = groupHits(props.hits)

  if (!props.isOpen) return null

  return (
    <AnimatePresence>
      <motion.div
        key="results"
        initial={isReduced ? false : { opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        exit={isReduced ? undefined : { opacity: 0, y: -4 }}
        transition={{ duration: 0.18 }}
        className={cn(
          'absolute top-full left-0 z-30 mt-0 w-full overflow-hidden',
          'max-h-[min(40vh,22rem)] rounded-b-xl border border-t-0 border-border',
          'bg-popover/95 text-popover-foreground shadow-md backdrop-blur-md'
        )}
        role="listbox"
        aria-label="搜索结果">
        <div className="flex flex-wrap gap-1 border-b border-border px-2 py-1.5">
          {FILTER_CHIPS.map(function (chip) {
            const isActive = props.filter === chip
            return (
              <Button
                key={chip}
                type="button"
                variant={isActive ? 'secondary' : 'ghost'}
                size="sm"
                className="h-6 rounded-md px-2 text-xs"
                onMouseDown={function (event) {
                  event.preventDefault()
                }}
                onClick={function () {
                  props.onFilter(chip)
                }}>
                {DOMAIN_LABEL[chip]}
              </Button>
            )
          })}
        </div>

        <div className="max-h-[min(34vh,18rem)] overflow-y-auto overscroll-contain p-1.5">
          {flatHits.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              无匹配结果
            </p>
          ) : (
            groups.map(function (group) {
              return (
                <div
                  key={group.domain}
                  className="mb-1.5 last:mb-0">
                  <div className="px-2 py-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                    {DOMAIN_LABEL[group.domain]}
                  </div>
                  {group.hits.map(function (hit) {
                    const index = flatHits.indexOf(hit)
                    const isActive = index === props.navigation
                    return (
                      <Button
                        key={`${hit.domain}:${hit.id}`}
                        type="button"
                        variant="ghost"
                        role="option"
                        aria-selected={isActive}
                        className={cn(
                          'h-auto w-full justify-start gap-2 rounded-lg px-2 py-1.5 text-left font-normal',
                          isActive
                            ? 'bg-accent text-accent-foreground hover:bg-accent'
                            : 'hover:bg-muted'
                        )}
                        onMouseEnter={function () {
                          props.onNavigate(index)
                        }}
                        onMouseDown={function (event) {
                          event.preventDefault()
                        }}
                        onClick={function () {
                          props.onSelect(hit)
                        }}>
                        <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted/80 text-muted-foreground">
                          <Icon
                            icon={hit.icon ?? 'lucide:search'}
                            aria-hidden
                            className="size-3.5"
                          />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">
                            {hit.title}
                          </span>
                          {hit.subtitle ? (
                            <span className="block truncate text-xs text-muted-foreground">
                              {hit.subtitle}
                            </span>
                          ) : null}
                        </span>
                      </Button>
                    )
                  })}
                </div>
              )
            })
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  )
}

export { ResultsSurface }
